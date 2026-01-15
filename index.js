const express = require("express");
const cors = require("cors");
const app = express();
const dotenv = require("dotenv");
dotenv.config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json());

// Connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xrkcnh7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const database = client.db("galleryDB");
    const imageCollection = database.collection("images");

    // GET: Paginated images (10 by 10)
    app.get("/images", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const images = await imageCollection
          .find()
          .sort({ createdAt: -1 }) // newest first
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await imageCollection.countDocuments();

        res.send({
          images,
          total,
          hasMore: skip + images.length < total,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // POST: Add new image
    app.post("/images", async (req, res) => {
      try {
        const {
          img,
          name,
          description,
          category,
          role,
          status,
          price,
          discountPercent,
          finalPrice,
          likes,
          createdAt,
        } = req.body;

        const newImage = {
          img,
          name,
          description,
          category,
          role,
          status,
          price: Number(price),
          discountPercent: Number(discountPercent),
          finalPrice: Number(finalPrice),
          likes: likes || 0,
          createdAt: createdAt || new Date(),
        };

        const result = await imageCollection.insertOne(newImage);

        res.status(201).json({
          message: "Image added successfully",
          insertedId: result.insertedId,
          data: newImage,
        });
      } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: error.message });
      }
    });

    app.delete("/images/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await imageCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World! this is gallery server");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
