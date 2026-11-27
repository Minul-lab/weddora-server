import express from "express";
import cors from "cors"
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";
const app = express();

app.use(express.json())
app.use(cors())
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
    const { search, category, location } = req.query;

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
app.post("/applications", async (req, res) => {
  const application = req.body;
  const result = await applications.insertOne(application);
  res.send(result);
});
app.get("/applications/user/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const query = { userId: id };

    const result = await applications.find(query).toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ message: "Failed to fetch applications" });
  }
});
app.get("/applications/vendor/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const query = { vendorId: id };

    const result = await applications.find(query).toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ message: "Failed to fetch applications" });
  }
});

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