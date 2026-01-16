const express = require("express");
const cors = require("cors");
const app = express();
const dotenv = require("dotenv");
dotenv.config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

// key conversion
const decoder = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
var serviceAccount = require("./firebase-admin-key.json");
// const serviceAccount = JSON.parse(decoder);

// const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// // Middleware
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
    // await client.connect();
    const database = client.db("galleryDB");
    const imageCollection = database.collection("images");
    const usersCollection = database.collection("users");

    // castom middleware for axios
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decodedToken = decoded;
        next();
      } catch (error) {
        return res.status(401).json({ message: "Unauthorized", error });
      }
    };

    // GET: Paginated images (10 by 10)
    app.get("/images",  async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const images = await imageCollection
          .find()
          .sort({ createdAt: -1 })
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

    app.get("/user-images", verifyToken, async (req, res) => {
      const { email, page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;

      const images = await imageCollection
        .find({ userEmail: email })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .toArray();

      const total = await imageCollection.countDocuments({ userEmail: email });

      res.json({
        images,
        hasMore: skip + images.length < total,
      });
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
          userEmail, // 👈 user info
          userName,
          userPhoto,
        } = req.body;

        // ⚡ Create the image object with user info
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

          // user info
          userEmail,
          userName,
          userPhoto,
        };

        const result = await imageCollection.insertOne(newImage);

        res.status(201).json({
          message: "Image added successfully 🌿",
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

    // user part ---------------------------

    // POST /users
    app.post("/users", async (req, res) => {
      const { name, email, phone, photo, password, provider } = req.body;

      const existingUser = await usersCollection.findOne({ email });

      if (existingUser) {
        return res.send({ message: "User already exists", inserted: false });
      }

      const newUser = {
        name,
        email,
        phone,
        photo,
        password, // you said you WANT to store it
        provider: provider || "email",
        role: "user",
        createdAt: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // GET /users/:email
    app.get("/users/:email", async (req, res) => {
      try {
        const user = await usersCollection.findOne({ email: req.params.email });
        res.send(user);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // POST /users/login
    app.post("/users/login", async (req, res) => {
      const { email, password } = req.body;

      try {
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res
            .status(404)
            .send({ success: false, message: "User not found" });
        }

        if (user.password !== password) {
          return res
            .status(401)
            .send({ success: false, message: "Invalid password" });
        }

        res.send({ success: true, message: "Login successful", user });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // GET /users/:email
    app.get("/users/:email", async (req, res) => {
      try {
        const user = await usersCollection.findOne({ email: req.params.email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get images uploaded by a specific user
    app.get("/images/user/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const images = await imageCollection
          .find({ userEmail: email })
          .toArray();
        res.send(images);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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
