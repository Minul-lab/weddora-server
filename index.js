import express from "express";
import cors from "cors"
import { MongoClient } from "mongodb";
const app = express();
app.use(express.json())
app.use(cors())
const port =process.env.PORT || 8000;
const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7hkgzuk.mongodb.net/`,
);
app.get("/", (req, res) => {
  res.send("Hello World! weddora");
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});