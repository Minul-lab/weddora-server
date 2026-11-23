import express from "express";
import cors from "cors"
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
const app = express();

app.use(express.json())
app.use(cors())
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


app.get("/", (req, res) => {
  res.send("Hello World! weddora");
});

app.get("/users", async(req,res)=>{
    const cursor = users.find({})
    const result =await cursor.toArray()
    res.send(result)
})

//services 
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});