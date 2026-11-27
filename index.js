import express from "express";
import cors from "cors"
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";
const app = express();

app.use(express.json())
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
}))
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const port =process.env.PORT || 8000;
const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7hkgzuk.mongodb.net/`,
);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const connectedClient = await connectToMongoDB();
const db = connectedClient.db("weddora")
const users = db.collection("user")
const services = db.collection("services")
const applications = db.collection("applications")
const payments = db.collection("payments")
// Resolve the Better Auth cookie through the client auth endpoint. Never trust
// userId or role values submitted in an application request body.
async function authenticate(req, res, next) {
  try {
    const cookie = req.get("cookie")
    const authBaseUrl = process.env.BETTER_AUTH_URL || process.env.CLIENT_URL || "http://localhost:3000"
    if (!cookie || !authBaseUrl) {
      return res.status(401).send({ message: "Sign in is required" })
    }

    const authUrl = new URL("/api/auth/get-session", authBaseUrl)
    authUrl.searchParams.set("disableCookieCache", "true")
    const response = await fetch(authUrl, {
      headers: { cookie },
      cache: "no-store",
    })
    if (!response.ok) {
      return res.status(401).send({ message: "Your session is invalid or expired" })
    }

    const authSession = await response.json()
    if (!authSession?.user?.id || !authSession?.session) {
      return res.status(401).send({ message: "Sign in is required" })
    }
    const databaseUser = await getUserById(authSession.user.id)
    if (authSession.user.isBlocked === true || databaseUser?.isBlocked === true) {
      return res.status(403).send({ message: "This account is blocked" })
    }

    req.authUser = { ...authSession.user, isBlocked: databaseUser?.isBlocked === true }
    next()
  } catch (error) {
    console.error("Could not verify Better Auth session:", error)
    return res.status(503).send({ message: "Unable to verify your session" })
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.authUser?.role !== role) {
      return res.status(403).send({ message: `Only ${role}s can perform this action` })
    }
    next()
  }
}

function validObjectId(value) {
  return typeof value === "string" && ObjectId.isValid(value)
}

async function findServiceById(id) {
  if (!validObjectId(id)) return null
  return services.findOne({ _id: new ObjectId(id) })
}

async function getUserById(id) {
  if (!validObjectId(id)) return null
  return users.findOne({ _id: new ObjectId(id) })
}

async function presentApplication(application) {
  const [customer, service] = await Promise.all([
    getUserById(application.userId),
    findServiceById(application.serviceId),
  ])
  return {
    ...application,
    status: application.status || "pending",
    userName: application.userName || customer?.name || "Customer",
    userEmail: application.userEmail || customer?.email || "",
    service: service ? {
      serviceName: service.serviceName,
      category: service.category,
      location: service.location,
      price: service.price,
      image: service.image || service.images?.[0] || "",
    } : null,
  }
}


app.get("/", (req, res) => {
  res.send("Hello World! weddora");
});

//user related api

app.get("/users", async(req,res)=>{
    const cursor = users.find({})
    const result =await cursor.toArray()
    res.send(result)
})
app.get("/users/:id/premium", async(req,res)=>{
  const id = req.params.id;
  const query = {_id: new ObjectId(id)};
  const result = await users.findOne(query,{projection:{premium:1,   }});
  res.send(result)
});

//services  related apis
app.get("/services", async (req, res) => {
  try {
    const { search, category, location , vendorId } = req.query;

    const filter = {};

    if (search) {
      filter.serviceName = {
        $regex: search.trim(),
        $options: "i",
      };
    }

    if (category) {
      filter.category = category;
    }

    if (location) {
      filter.location = {
        $regex: location.trim(),
        $options: "i",
      };
    }
    if(vendorId){
      filter.vendorId = vendorId;
    }

    const result = await services.find(filter).toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Something went wrong" });
  }
});
// service detail api
app.get("/services/count", async (req, res) => {
  const query = {};

  if (req.query.vendorId) {
    query.vendorId = req.query.vendorId;
  }

  const count = await services.countDocuments(query);

  res.send({ count: count });
});
app.get("/services/:id",async(req,res)=>{
  const id = req.params.id;
  const query = {_id: new ObjectId(id)};
  const result = await services.findOne(query);
  res.send(result)
})
app.get("/services/count", async (req, res) => {
  const query = {};

  if (req.query.vendorId) {
    query.vendorId = req.query.vendorId;
  }

  const count = await services.countDocuments(query);

  res.send({ count: count });
});
// get services by vendor id
// app.get("/services/vendor/:id", async (req, res) => {
//   const vendorId = req.params.id;
//   const query = { vendorId: vendorId };
//   const result = await services.find(query).toArray();
//   res.send(result);
// });
app.post("/services",async(req,res)=>{
    const service = req.body
    const result  = await services.insertOne(service)
    res.send(result)
})
app.delete("/services/:id", async(req,res)=>{
  const id = req.params.id;
  const query = {_id: new ObjectId(id)};
  const result = await services.deleteOne(query);
  res.send(result)
})


// applications related apis
app.post("/applications", authenticate, requireRole("customer"), async (req, res) => {
  try {
    const { serviceId, eventDate, eventLocation, message } = req.body || {}
    if (!validObjectId(serviceId)) {
      return res.status(400).send({ message: "A valid serviceId is required" })
    }
    if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return res.status(400).send({ message: "A valid eventDate is required" })
    }
    if (!eventLocation || typeof eventLocation !== "string" || !eventLocation.trim()) {
      return res.status(400).send({ message: "An event location is required" })
    }

    const service = await findServiceById(serviceId)
    if (!service) return res.status(404).send({ message: "Service not found" })
    const serviceStatus = String(service.status || service.approvalStatus || "").toLowerCase()
    if ((serviceStatus && serviceStatus !== "approved" && serviceStatus !== "active") || service.isActive === false || service.isAvailable === false) {
      return res.status(409).send({ message: "This service is not available for booking" })
    }

    const vendorId = String(service.vendorId || "")
    if (!vendorId) return res.status(409).send({ message: "This service has no vendor" })
    if (vendorId === String(req.authUser.id)) {
      return res.status(403).send({ message: "You cannot book your own service" })
    }

    const duplicate = await applications.findOne({
      userId: String(req.authUser.id),
      serviceId,
      eventDate,
      status: { $in: ["pending", "accepted", null] },
    })
    if (duplicate) {
      return res.status(409).send({ message: "You already have an active request for this service and date" })
    }

    const vendor = await getUserById(vendorId)
    const application = {
      serviceId,
      vendorId,
      vendorName: vendor?.businessName || vendor?.name || "Vendor",
      serviceName: service.serviceName,
      userId: String(req.authUser.id),
      userName: req.authUser.name || "Customer",
      userEmail: req.authUser.email || "",
      eventDate,
      eventLocation: eventLocation.trim(),
      message: typeof message === "string" ? message.trim() : "",
      status: "pending",
      createdAt: new Date(),
    }

    const result = await applications.insertOne(application)
    return res.status(201).send({ ...application, _id: result.insertedId })
  } catch (error) {
    console.error("Error creating booking request:", error)
    return res.status(500).send({ message: "Failed to create booking request" })
  }
})

app.get("/applications/user/:id", authenticate, requireRole("customer"), async (req, res) => {
  try {
    if (req.params.id !== String(req.authUser.id)) {
      return res.status(403).send({ message: "You can only view your own bookings" })
    }
    const result = await applications.find({ userId: String(req.authUser.id) }).sort({ createdAt: -1 }).toArray()
    const presented = await Promise.all(result.map(presentApplication))
    return res.status(200).send(presented)
  } catch (error) {
    console.error("Error fetching customer applications:", error)
    return res.status(500).send({ message: "Failed to fetch bookings" })
  }
})

app.get("/applications/vendor/:id", authenticate, requireRole("vendor"), async (req, res) => {
  try {
    const vendorId = String(req.authUser.id)
    if (req.params.id !== vendorId) {
      return res.status(403).send({ message: "You can only view requests for your own services" })
    }

    const result = await applications.find({ vendorId }).sort({ createdAt: -1 }).toArray()
    const ownedRequests = []
    for (const application of result) {
      const service = await findServiceById(application.serviceId)
      // Verify the application still points to a service this vendor owns.
      if (service && String(service.vendorId) === vendorId) {
        ownedRequests.push(await presentApplication(application))
      }
    }
    return res.status(200).send(ownedRequests)
  } catch (error) {
    console.error("Error fetching vendor applications:", error)
    return res.status(500).send({ message: "Failed to fetch booking requests" })
  }
})

app.patch("/applications/:id/status", authenticate, requireRole("vendor"), async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body || {}
    const vendorId = String(req.authUser.id)
    if (!validObjectId(id)) return res.status(400).send({ message: "Invalid booking request ID" })
    if (status !== "accepted" && status !== "rejected") {
      return res.status(400).send({ message: "Status must be accepted or rejected" })
    }

    const filter = { _id: new ObjectId(id), vendorId }
    const application = await applications.findOne(filter)
    if (!application) return res.status(404).send({ message: "Booking request not found for your services" })

    const service = await findServiceById(application.serviceId)
    if (!service || String(service.vendorId) !== vendorId) {
      return res.status(404).send({ message: "Booking request not found for your services" })
    }
    if (application.status && application.status !== "pending") {
      return res.status(409).send({ message: "This booking request has already been processed" })
    }

    const update = await applications.updateOne(
      { ...filter, status: { $in: ["pending", null] } },
      { $set: { status, updatedAt: new Date() } }
    )
    if (update.modifiedCount !== 1) {
      return res.status(409).send({ message: "This booking request has already been processed" })
    }

    const updated = await applications.findOne(filter)
    return res.status(200).send(await presentApplication(updated))
  } catch (error) {
    console.error("Error processing vendor booking request:", error)
    return res.status(500).send({ message: "Failed to update booking request" })
  }
})
// payment related apis

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.send({
        success: false,
        message: "sessionId is required",
      });
    }

    const { status, payment_status, customer_email, metadata, payment_intent } =
      await stripe.checkout.sessions.retrieve(sessionId);

    if (status !== "complete" || payment_status !== "paid") {
      return res.send({
        success: false,
        message: "Payment verification failed",
      });
    }

    // Check whether this session was already processed
    const existingSession = await payments.findOne({ sessionId });

    if (existingSession) {
      return res.send({
        success: false,
        message: "Session already exists",
      });
    }

    // Validate user ID from Stripe metadata
    if (!metadata?.userId || !ObjectId.isValid(metadata.userId)) {
      return res.send({
        success: false,
        message: "Invalid user information",
      });
    }

    // Insert payment information
    const payment = {
      sessionId,
      status,
      customer_email,
      userId: metadata.userId,
      payment_status,
      payment_intent,
    };

    const result = await payments.insertOne(payment);

    // Update user premium status
    const query = {
      _id: new ObjectId(metadata.userId),
    };

    const updatedDoc = {
      $set: {
        premium: true,
      },
    };

    const updateResult = await users.updateOne(query, updatedDoc);

    return res.send({
      success: true,
      result,
      updateResult,
    });
  } catch (error) {
    console.error("Payment verification error:", error);

    return res.status(500).send({
      success: false,
      message: "Internal server error",
    });
  }
});


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});