const express = require("express");
const cors = require("cors");
const app = express();
const dotenv = require("dotenv");
dotenv.config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// key conversion
const decoder = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8",
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
    const paymentCollection = database.collection("payments");

    // castom middleware for axios
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded; // ✅ attach user info to req.user
        next();
      } catch (error) {
        return res.status(401).json({ message: "Unauthorized", error });
      }
    };

    // admin verification middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || (user.role !== "admin" && user.status !== "premium")) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyPremiumUser = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user && user.status !== "premium") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyStandardUser = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user && user.status !== "standard" && user.status !== "premium") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // GET: Paginated images (10 by 10)
    // GET /images
    app.get("/images", async (req, res) => {
      try {
        const { page = 1, category, status, role } = req.query;
        const limit = 20;
        const skip = (page - 1) * limit;

        // Build filter object
        const filter = {};
        if (category && category !== "All") filter.category = category;
        if (status && status !== "All") filter.status = status;
        if (role && role !== "All") filter.role = role;

        const images = await imageCollection
          .find(filter)
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalCount = await imageCollection.countDocuments(filter);

        res.send({
          images,
          hasMore: skip + images.length < totalCount,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch images" });
      }
    });

    app.get("/user-images", verifyToken, async (req, res) => {
      const { email, page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;
      const emailFromToken = req.user.email;

      if (email !== emailFromToken) {
        return res.status(403).json({ message: "Forbidden access" });
      }

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
          status: "Pending", // New images are pending by default
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

    // TOGGLE LIKE
    app.patch("/images/:id/like", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email; // ✅ now exists
        const imageId = req.params.id;

        if (!ObjectId.isValid(imageId))
          return res.status(400).json({ message: "Invalid image ID" });

        const img = await imageCollection.findOne({
          _id: new ObjectId(imageId),
        });
        if (!img) return res.status(404).json({ message: "Image not found" });

        if (!Array.isArray(img.likes)) img.likes = [];

        const updatedLikes = img.likes.includes(userEmail)
          ? img.likes.filter((e) => e !== userEmail)
          : [...img.likes, userEmail];

        await imageCollection.updateOne(
          { _id: new ObjectId(imageId) },
          { $set: { likes: updatedLikes } },
        );

        res.json({ likes: updatedLikes.length, emails: updatedLikes });
      } catch (err) {
        console.error("Like API Error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // TOGGLE FAVORITE
    app.patch("/images/:id/favorite", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email; // from verifyToken
        const imageId = req.params.id;

        if (!ObjectId.isValid(imageId)) {
          return res.status(400).json({ message: "Invalid image ID" });
        }

        // Find image
        const img = await imageCollection.findOne({
          _id: new ObjectId(imageId),
        });
        if (!img) return res.status(404).json({ message: "Image not found" });

        if (!Array.isArray(img.favorites)) img.favorites = [];

        let updatedFavs;
        if (img.favorites.includes(userEmail)) {
          updatedFavs = img.favorites.filter((e) => e !== userEmail);
        } else {
          updatedFavs = [...img.favorites, userEmail];
        }

        await imageCollection.updateOne(
          { _id: new ObjectId(imageId) },
          { $set: { favorites: updatedFavs } },
        );

        res.json({ favorites: updatedFavs, emails: updatedFavs });
      } catch (err) {
        console.error("Favorite API Error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /users/:email/favorites
    app.get("/users/:email/favorites",  async (req, res) => {
      const { email } = req.params;

      try {
        

        const images = await imageCollection
          .find({ favorites: email }) // favorites: [{email: '...'}]
          .toArray();

        res.send(images);
      } catch (err) {
        console.error("Favorites API Error:", err);
        res.status(500).send({ message: "Failed to load favorites" });
      }
    });

    // GET /favorites
    app.get("/favorites", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email;

        const images = await imageCollection
          .find({ favorites: userEmail })
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ images });
      } catch (err) {
        console.error("Get Favorites Error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // user part ---------------------------

    // GET /users_profile/:email
    app.get("/users_profile/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;

        if (req.user.email !== email) {
          return res.status(403).json({ message: "Forbidden access" });
        }
       

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.send(user);
      } catch (err) {
        console.error("Error fetching user profile:", err);
        res.status(500).json({ message: "Server error", error: err });
      }
    });

    // GET /users/:email
    app.get("/users/:email", verifyToken, async (req, res) => {
      try {
        if (req.user.email !== req.params.email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
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
    app.get("/images/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (req.decodedToken.email !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      try {
        const images = await imageCollection
          .find({ userEmail: email })
          .toArray();
        res.send(images);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

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

    // POST /users/login
    app.post("/users/login", async (req, res) => {
      try {
        const { email } = req.body;
        const user = await usersCollection.findOne({ email });

        if (!user)
          return res.json({ success: false, message: "User not found" });

        res.json({ success: true, user, message: "Login successful" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // POST /auth/google register
    app.post("/auth/google", async (req, res) => {
      try {
        const { email, name, photo } = req.body;

        if (!email)
          return res.status(400).json({ message: "Email is required" });

        // Check if user already exists
        let user = await usersCollection.findOne({ email });

        if (user) {
          return res.status(200).json({
            success: true,
            existing: true,
            message: "Welcome back! You are already registered.",
            user,
          });
        }

        // If user does not exist, create new with minimum + random data
        const newUser = {
          name: name || "Random User",
          email,
          phone: "+880" + Math.floor(Math.random() * 1000000000), // random Bangladeshi phone
          photo: photo || "https://i.ibb.co/0j3r0tH/default-avatar.png",
          password: "google_auth", // placeholder password
          provider: "google",
          role: "user", // default status
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        return res.status(201).json({
          success: true,
          existing: false,
          message: "Account created successfully with Google ✨",
          user: newUser,
        });
      } catch (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: "Server error during Google login",
        });
      }
    });

    // POST /auth/google_login
    app.post("/auth/google_login", async (req, res) => {
      try {
        const { email, name, photo } = req.body;
        const user = await usersCollection.findOne({ email });

        if (user) {
          return res.json({
            success: true,
            existing: true,
            user,
            message: "Logged in successfully",
          });
        } else {
          return res.json({
            success: true,
            existing: false,
            message: "Google account not registered",
          });
        }
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.delete("/users_profile/:email", async (req, res) => {
      try {
        const result = await usersCollection.deleteOne({
          email: req.params.email,
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ message: "User deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // subscription part-------------------------

    app.get("/subscriptions/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user.email;
      if (email !== decodedEmail) {
        return res.status(403).json({ message: "Forbidden access" });
      }
      const user = await usersCollection.findOne({ email });
      if (user) {
        res.status(200).json(user);
      } else {
        res.status(404).json({ message: "User not found" });
      }
    });

    // subscriptions/${id}
    app.get("/users/subscriptions/:id", verifyToken, async (req, res) => {
      const decodedEmail = req.user.email;
      const id = req.params.id;

      const user = await usersCollection.findOne({ _id: new ObjectId(id) });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.email !== decodedEmail) {
        return res.status(403).json({ message: "Forbidden access" });
      }

      res.status(200).json(user);
    });

    // payment part-------------------------

    app.post("/create-payment-intent", async (req, res) => {
      const { amount, email, name } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: parseInt(amount) * 100,
          currency: "bdt",
          payment_method_types: ["card"],
          metadata: { email, name },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Payment Intent Error:", error);
        res.status(500).send({ error: "Payment creation failed" });
      }
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });

    // PATCH /users/premium
    app.patch("/users/premium", async (req, res) => {
      const { email, amount, transactionId } = req.body;

      let status = "explorer";
      if (parseInt(amount) === 999) {
        status = "artist";
      } else if (parseInt(amount) === 1999) {
        status = "curator";
      } else if (parseInt(amount) === 0) {
        status = "free";
      }

      const result = await usersCollection.updateOne(
        { email: email },
        {
          $set: {
            user_status: status,
            transactionId,
            subscriptionDate: new Date(),
          },
        },
      );

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
