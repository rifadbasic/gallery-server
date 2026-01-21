const express = require("express");
const cors = require("cors");
const app = express();
const dotenv = require("dotenv");
const FormData = require("form-data");
const axios = require("axios");
const sharp = require("sharp");
dotenv.config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const transporter = require("./mailer");
const upload = require("./upload");

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
      if (
        !user ||
        (user.role !== "admin" &&
          user.status !== "creator" &&
          user.status !== "artist" &&
          user.status !== "explorer")
      ) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyCreatorUser = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user && user.status !== "creator") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyArtistUser = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user && user.status !== "artist" && user.status !== "creator") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // GET: Paginated images (10 by 10)
    // GET /images
    app.get("/images", verifyToken, async (req, res) => {
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

    app.get("/user-images", verifyToken, verifyArtistUser, async (req, res) => {
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

    // GET /images/favorites/:email
    app.get(
      "/images/favorites/:email",
      verifyToken,
      verifyArtistUser,
      async (req, res) => {
        const email = req.params.email;
        try {
          const favorites = await imageCollection
            .find({ favorites: { $in: [email] } })
            .sort({ createdAt: -1 })
            .toArray();
          res.json(favorites);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: err.message });
        }
      },
    );

    // GET /images/purchased/:email
    app.get(
      "/images/purchased/:email",
      verifyToken,
      verifyArtistUser,
      async (req, res) => {
        const email = req.params.email;
        try {
          const purchased = await imageCollection
            .find({ sold: { $elemMatch: { buyerEmail: email } } })
            .sort({ createdAt: -1 })
            .toArray();
          res.json(purchased);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: err.message });
        }
      },
    );

    app.get("/images/category/:category", verifyToken, async (req, res) => {
      try {
        const { category } = req.params;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const search = req.query.search || "";

        const skip = (page - 1) * limit;

        const query = {
          category: { $regex: category, $options: "i" },
          $or: [
            { name: { $regex: search, $options: "i" } },
            { role: { $regex: search, $options: "i" } },
          ],
        };

        const images = await imageCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(); // 🔥 THIS WAS MISSING

        res.send({ images });
      } catch (error) {
        console.error("Category image error:", error);
        res.status(500).send({ error: "Server Error" });
      }
    });

    // POST /images

    app.post("/images", upload.single("image"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "Image file is required" });
        }

        const {
          name,
          description,
          category,
          role,
          price,
          discountPercent,
          finalPrice,
          likes,
          createdAt,
          userEmail,
          userName,
          userPhoto,
        } = req.body;

        // 1️⃣ Original buffer
        const originalBuffer = req.file.buffer;

        // 2️⃣ Metadata
        const metadata = await sharp(originalBuffer).metadata();
        const { width, height, format } = metadata;

        /* ============================
       🔹 A) UPLOAD ORIGINAL IMAGE
       ============================ */
        const imgbbUrl = `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`;

        const originalUpload = await axios.post(
          imgbbUrl,
          new URLSearchParams({
            image: originalBuffer.toString("base64"),
          }).toString(),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        );

        const originalImageUrl = originalUpload.data.data.url;

        /* ============================
       🔹 B) CREATE WATERMARK
       ============================ */
        const tileSize = Math.floor(width / 4); // 🔧 bigger tiles
        const fontSize = Math.floor(tileSize / 3);

        let svgTiles = "";

        for (let y = 0; y < height; y += tileSize) {
          for (let x = 0; x < width; x += tileSize) {
            svgTiles += `
                    <text
                      x="${x + tileSize / 2}"
                      y="${y + tileSize / 2}"
                      text-anchor="middle"
                      dominant-baseline="middle"
                      font-size="${fontSize}"
                      font-family="Arial, Helvetica, sans-serif"
                      font-weight="900"
                      fill="white"
                      fill-opacity="0.45"
                      stroke="black"
                      stroke-width="2"
                      stroke-opacity="0.35"
                      transform="rotate(-30, ${x + tileSize / 2}, ${y + tileSize / 2})"
                    >
                      GALLERY
                    </text>
                  `;
          }
        }

        const svgWatermark = `
              <svg width="${width}" height="${height}">
                ${svgTiles}
              </svg>
              `;

        const watermarkedBuffer = await sharp(originalBuffer)
          .composite([
            {
              input: Buffer.from(svgWatermark),
              blend: "overlay",
            },
          ])
          .jpeg({ quality: 95 })
          .toBuffer();

        /* ============================
       🔹 C) UPLOAD WATERMARK IMAGE
       ============================ */
        const watermarkUpload = await axios.post(
          imgbbUrl,
          new URLSearchParams({
            image: watermarkedBuffer.toString("base64"),
          }).toString(),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        );

        const watermarkedImageUrl = watermarkUpload.data.data.url;

        /* ============================
       🔹 D) DB PAYLOAD
       ============================ */
        const newImage = {
          originalImage: originalImageUrl, // ✅ FULL QUALITY
          watermarkedImage: watermarkedImageUrl, // ✅ PROTECTED

          name,
          description,
          category,
          role,
          status: "Pending",

          price: Number(price),
          discountPercent: Number(discountPercent),
          finalPrice: Number(finalPrice),
          likes: Number(likes) || 0,
          createdAt: createdAt || new Date(),

          userEmail,
          userName,
          userPhoto,

          width,
          height,
          format,
          size: originalBuffer.length,
        };

        const result = await imageCollection.insertOne(newImage);

        res.status(201).json({
          message: "Image uploaded (original + watermark) ✨",
          insertedId: result.insertedId,
          data: newImage,
        });
      } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // POST /images/upload
    app.post("/images/upload", upload.single("image"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image provided" });
        }

        const buffer = req.file.buffer;

        const imgbbUrl = `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`;

        const uploadRes = await axios.post(
          imgbbUrl,
          new URLSearchParams({
            image: buffer.toString("base64"),
          }).toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          },
        );

        res.json({
          url: uploadRes.data.data.url,
        });
      } catch (err) {
        console.error("Upload error:", err.message);
        res.status(500).json({ error: "Upload failed" });
      }
    });

    // Update Image
    app.put("/images/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const {
          name,
          description,
          category,
          role,
          price,
          discountPercent,
          finalPrice,
          originalImage, // new image URL (optional)
        } = req.body;

        const updateDoc = {
          ...(name && { name }),
          ...(description && { description }),
          ...(category && { category }),
          ...(role && { role }),
          ...(price !== undefined && { price: Number(price) }),
          ...(discountPercent !== undefined && {
            discountPercent: Number(discountPercent),
          }),
          ...(finalPrice !== undefined && { finalPrice: Number(finalPrice) }),

          status: "Pending",
          updatedAt: new Date(),
        };

        if (originalImage && originalImage.startsWith("http")) {
          const response = await axios.get(originalImage, {
            responseType: "arraybuffer",
          });
          const originalBuffer = Buffer.from(response.data, "binary");

          const metadata = await sharp(originalBuffer).metadata();
          const { width, height, format } = metadata;

          const tileSize = Math.floor(width / 4); // 🔧 SAME AS POST
          const fontSize = Math.floor(tileSize / 3);

          let svgTiles = "";
          for (let y = 0; y < height; y += tileSize) {
            for (let x = 0; x < width; x += tileSize) {
              svgTiles += `
              <text
                x="${x + tileSize / 2}"
                y="${y + tileSize / 2}"
                text-anchor="middle"
                dominant-baseline="middle"
                font-size="${fontSize}"
                font-family="Arial, Helvetica, sans-serif"
                font-weight="900"
                fill="white"
                fill-opacity="0.45"
                stroke="black"
                stroke-width="2"
                stroke-opacity="0.35"
                transform="rotate(-30, ${x + tileSize / 2}, ${y + tileSize / 2})"
              >
                GALLERY
              </text>
            `;
                    }
                  }

                  const svgWatermark = `
        <svg width="${width}" height="${height}">
          ${svgTiles}
        </svg>
        `;

          const watermarkedBuffer = await sharp(originalBuffer)
            .composite([
              {
                input: Buffer.from(svgWatermark),
                blend: "overlay",
              },
            ])
            .jpeg({ quality: 95 })

            .toBuffer();

          const imgbbUrl = `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`;
          const uploadRes = await axios.post(
            imgbbUrl,
            new URLSearchParams({
              image: watermarkedBuffer.toString("base64"),
            }).toString(),
            {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            },
          );

          const watermarkedUrl = uploadRes.data.data.url;

          Object.assign(updateDoc, {
            originalImage,
            watermarkedImage: watermarkedUrl,

            width,
            height,
            format,
            size: originalBuffer.length,
          });
        }

        await imageCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc },
        );

        res.json({
          message: "Image updated successfully 🌿",
          updatedFields: updateDoc,
        });
      } catch (error) {
        console.error("Update Error:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/images/bulk-delete", verifyToken, async (req, res) => {
      const { imageIds } = req.body;

      if (!Array.isArray(imageIds)) {
        return res.status(400).json({ message: "Invalid image IDs" });
      }

      const objectIds = imageIds.map((id) => new ObjectId(id));

      const result = await imageCollection.deleteMany({
        _id: { $in: objectIds },
      });

      res.send({
        deletedCount: result.deletedCount,
      });
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

    // DELETE /images/purchased/:imageId/:userEmail
    app.delete("/images/purchased/:imageId/:userEmail", async (req, res) => {
      const { imageId, userEmail } = req.params;

      try {
        // 1️⃣ Remove from user's downloads
        await usersCollection.updateOne(
          { email: userEmail },
          {
            $pull: {
              downloads: { imageId },
            },
          },
        );

        // 2️⃣ Remove from image sold array
        const image = await imageCollection.findOne({
          _id: new ObjectId(imageId),
        });

        if (!image) return res.status(404).json({ error: "Image not found" });

        // Remove the buyer object from sold array
        await imageCollection.updateOne(
          { _id: new ObjectId(imageId) },
          { $pull: { sold: { buyerEmail: userEmail } } },
        );

        // 3️⃣ Optional: If the image belongs to current user and no one else has purchased it, delete the image entirely
        if (
          image.userEmail === userEmail &&
          (!image.sold || image.sold.length === 0)
        ) {
          await imageCollection.deleteOne({ _id: new ObjectId(imageId) });
        }

        res.json({ message: "Deleted purchased image successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
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
    app.patch(
      "/images/:id/favorite",
      verifyToken,
      verifyArtistUser,
      async (req, res) => {
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
      },
    );

    // GET /users/:email/favorites
    app.get(
      "/users/:email/favorites",
      verifyToken,
      verifyArtistUser,
      async (req, res) => {
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
      },
    );

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

    // delete user profile
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

    // profile update
    app.post(
      "/users/upload-image",
      upload.single("image"),
      async (req, res) => {
        try {
          if (!req.file) {
            return res.status(400).json({ error: "No image file provided" });
          }

          const imgbbUrl = `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`;

          const uploadRes = await axios.post(
            imgbbUrl,
            new URLSearchParams({
              image: req.file.buffer.toString("base64"),
            }).toString(),
            {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            },
          );

          res.json({ url: uploadRes.data.data.url });
        } catch (err) {
          console.error("Image upload error:", err.message);
          res.status(500).json({ error: "Image upload failed" });
        }
      },
    );

    app.put("/users_profile/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const { name, shortName, phone, photo, coverPhoto, location, bio } =
          req.body;

        const updateDoc = {
          ...(name && { name }),
          ...(shortName && { shortName }),
          ...(phone && { phone }),
          ...(photo && { photo }),
          ...(coverPhoto && { coverPhoto }),
          ...(location && { location }),
          ...(bio && { bio }),
          updatedAt: new Date(),
        };

        await usersCollection.updateOne({ email }, { $set: updateDoc });

        res.json({
          message: "Profile updated successfully 🌿",
          updatedFields: updateDoc,
        });
      } catch (err) {
        console.error("Profile update error:", err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // random show user  profile
    app.get("/user_profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      try {
        if (!req.user || !req.user.email) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (err) {
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    app.get("/images/user_profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      try {
        if (!req.user || !req.user.email) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const images = await imageCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.json(images);
      } catch (err) {
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // dashboard pasrt fos a single user
    app.get("/dashboard/images", verifyToken, async (req, res) => {
      const { userEmail } = req.query;

      const images = await imageCollection
        .find({ userEmail })
        .sort({ createdAt: -1 }) // latest first
        .limit(6) // 🔥 ONLY 6
        .toArray();

      res.send(images);
    });

    app.get("/dashboard/images/count", verifyToken, async (req, res) => {
      const { userEmail } = req.query;

      const count = await imageCollection.countDocuments({ userEmail });

      res.send({ count });
    });

    app.get("/dashboard/favorites/count", verifyToken, async (req, res) => {
      const { userEmail } = req.query;

      const count = await imageCollection.countDocuments({
        favorites: userEmail,
      });

      res.send({ count });
    });

    app.get("/dashboard/purchases", verifyToken, async (req, res) => {
      const { userEmail } = req.query;

      const user = await usersCollection.findOne(
        { email: userEmail },
        { projection: { downloads: 1 } },
      );

      res.send(user?.downloads || []);
    });

    app.get("/dashboard/favorites", verifyToken, async (req, res) => {
      const { userEmail } = req.query;

      const favorites = await imageCollection
        .find({ favorites: userEmail }) // array contains email
        .sort({ updatedAt: -1 })
        .limit(6) // 🔥 ONLY 6
        .toArray();

      res.send(favorites);
    });

    app.get("/dashboard/earnings", verifyToken, async (req, res) => {
      const { userEmail } = req.query;

      if (!userEmail) {
        return res.status(400).send({ message: "Email required" });
      }

      const income = await paymentCollection
        .find({
          pay_for: "image",
          sellerEmail: userEmail,
        })
        .project({ total: { $sum: "$amount" } })
        .toArray();

      // total ammount er sum
      const total = income.reduce((acc, curr) => acc + curr.total, 0);

      res.send({ total });
    });

    app.get("/dashboard/payments", verifyToken, async (req, res) => {
      const { userEmail, limit = 10, skip = 0 } = req.query;

      const payments = await paymentCollection
        .find({
          $or: [
            { buyerEmail: userEmail },
            { email: userEmail }, // subscription
          ],
        })
        .sort({ date: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .toArray();

      res.send(payments);
    });

    // -----user account data----------------------
    app.get("/account/sold", verifyToken, async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      const soldCount = await paymentCollection.countDocuments({
        pay_for: "image",
        sellerEmail: email,
      });

      res.send({ count: soldCount });
    });

    app.get("/account/income", verifyToken, async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      const income = await paymentCollection
        .find({
          pay_for: "image",
          sellerEmail: email,
        })
        .project({ total: { $sum: "$amount" } })
        .toArray();

      // total ammount er sum
      const total = income.reduce((acc, curr) => acc + curr.total, 0);

      res.send({ total });
    });

    // ----admin part-------------------------

    app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      const { page = 1, limit = 20, search = "" } = req.query;
      const skip = (page - 1) * limit;

      if (!req.user || !req.user.email) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };

      const users = await usersCollection
        .find(query)
        .skip(skip)
        .limit(Number(limit))
        .toArray();

      res.send({ users });
    });

    app.post("/admin/change-role", async (req, res) => {
      const { email, role } = req.body;

      const newStatus = role === "admin" ? "creator" : "explorer";

      await usersCollection.updateOne(
        { email },
        {
          $set: {
            role,
            user_status: newStatus,
          },
        },
      );

      res.send({ success: true, user_status: newStatus });
    });

    app.post("/admin/disable-subscription", async (req, res) => {
      try {
        const { paymentId } = req.body;

        const result = await paymentCollection.updateOne(
          { _id: new ObjectId(paymentId) },
          { $set: { status: "disabled" } },
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "Subscription not found" });
        }

        res.send({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    app.post("/admin/delete-user", async (req, res) => {
      const { email } = req.body;

      // 1) Delete from MongoDB
      await usersCollection.deleteOne({ email });

      // 2) Delete from Firebase Auth
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(user.uid);

      res.send({ success: true });
    });

    app.get(
      "/admin/subscriptions",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          if (!req.user || !req.user.email) {
            return res.status(401).json({ message: "Unauthorized" });
          }

          const { page = 1, limit = 10, search = "" } = req.query;

          const skip = (Number(page) - 1) * Number(limit);

          const query = {
            pay_for: "subscription",
            ...(search && {
              email: { $regex: search, $options: "i" },
            }),
          };

          const total = await paymentCollection.countDocuments(query);

          const subscriptions = await paymentCollection
            .find(query)
            .sort({ date: -1 }) // newest first
            .skip(skip)
            .limit(Number(limit))
            .toArray();

          res.send({
            subscriptions,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: Number(page),
          });
        } catch (err) {
          console.error(err);
          res.status(500).send({ error: "Failed to fetch subscriptions" });
        }
      },
    );

    app.post("/admin/remove-subscription", async (req, res) => {
      try {
        const { email, paymentId } = req.body;

        // ১) Payment DB → subscription disable করবো
        await paymentCollection.updateOne(
          { _id: new ObjectId(paymentId) },
          { $set: { status: "disabled" } },
        );

        // ২) Users DB → user_status = "explorer"
        await usersCollection.updateOne(
          { email },
          { $set: { user_status: "explorer" } },
        );

        res.send({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to remove subscription" });
      }
    });

    app.delete("/admin/delete-subscription/:paymentId", async (req, res) => {
      try {
        const { paymentId } = req.params;

        await paymentCollection.deleteOne({
          _id: new ObjectId(paymentId),
        });

        res.send({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to delete subscription" });
      }
    });

    app.get(
      "/admin/payments/subscriptions",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { limit = 10, search = "" } = req.query;

          const query = {
            pay_for: "subscription",
            ...(search && {
              $or: [
                { email: { $regex: search, $options: "i" } },
                { name: { $regex: search, $options: "i" } },
              ],
            }),
          };

          const data = await paymentCollection
            .find(query)
            .sort({ date: -1 })
            .limit(Number(limit))
            .toArray();

          const total = await paymentCollection.countDocuments(query);

          res.send({ payments: data, total });
        } catch (err) {
          console.error(err);
          res.status(500).send({ error: "Failed to fetch subscriptions" });
        }
      },
    );

    app.get(
      "/admin/payments/image",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { limit = 10, search = "" } = req.query;

          const query = {
            pay_for: "image",
            ...(search && {
              $or: [
                { buyerEmail: { $regex: search, $options: "i" } },
                { sellerEmail: { $regex: search, $options: "i" } },
                { imageName: { $regex: search, $options: "i" } },
              ],
            }),
          };

          const data = await paymentCollection
            .find(query)
            .sort({ date: -1 })
            .limit(Number(limit))
            .toArray();

          const total = await paymentCollection.countDocuments(query);

          res.send({ payments: data, total });
        } catch (err) {
          res.status(500).send({ error: "Failed to fetch image payments" });
        }
      },
    );

    app.get(
      "/admin/payments/images",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 10;
          const search = req.query.search || "";

          const query = {
            pay_for: "image",
            ...(search && {
              $or: [
                { buyerEmail: { $regex: search, $options: "i" } },
                { sellerEmail: { $regex: search, $options: "i" } },
                { imageName: { $regex: search, $options: "i" } },
              ],
            }),
          };

          const total = await paymentCollection.countDocuments(query);

          const payments = await paymentCollection
            .find(query)
            .sort({ date: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

          res.send({ payments, total });
        } catch (err) {
          console.error(err);
          res.status(500).send({ error: "Failed to fetch image payments" });
        }
      },
    );

    app.delete("/admin/payments/images/:id", async (req, res) => {
      try {
        const { id } = req.params;

        await paymentCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: true });
      } catch (err) {
        res.status(500).send({ success: false });
      }
    });

    app.post("/admin/payments/images/bulk-delete", async (req, res) => {
      try {
        const { ids } = req.body;

        const objectIds = ids.map((id) => new ObjectId(id));

        await paymentCollection.deleteMany({
          _id: { $in: objectIds },
        });

        res.send({ success: true });
      } catch (err) {
        res.status(500).send({ success: false });
      }
    });

    // GET /admin/payments/subscriptions?page=&limit=&search=
    app.get(
      "/admin/payments/subscriptions",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 10;
          const search = req.query.search || "";

          const query = {
            pay_for: "subscription",
            ...(search && {
              $or: [
                { buyerEmail: { $regex: search, $options: "i" } },
                { subscriptionType: { $regex: search, $options: "i" } },
              ],
            }),
          };

          const total = await paymentCollection.countDocuments(query);

          const payments = await paymentCollection
            .find(query)
            .sort({ date: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

          res.send({ payments, total });
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ error: "Failed to fetch subscription payments" });
        }
      },
    );

    // all images
    app.get("/admin/images", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || "";

        const query = {
          ...(search && {
            $or: [
              { userEmail: { $regex: search, $options: "i" } },
              { imageName: { $regex: search, $options: "i" } },
              { status: { $regex: search, $options: "i" } },
            ],
          }),
        };

        const total = await imageCollection.countDocuments(query);

        // Pending first, then date desc
        const images = await imageCollection
          .find(query)
          .sort({ status: 1, date: -1 }) // Pending=0, Unsold=1 or alphabetically Pending first
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        res.send({ images, total });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch images" });
      }
    });

    app.post(
      "/admin/images/toggle-status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { imageId, status } = req.body;

          const result = await imageCollection.updateOne(
            { _id: new ObjectId(imageId) },
            { $set: { status } },
          );

          if (result.modifiedCount === 0)
            return res
              .status(404)
              .send({ success: false, message: "Image not found" });

          res.send({ success: true, status });
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ success: false, message: "Failed to update status" });
        }
      },
    );

    app.delete(
      "/admin/images/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          await imageCollection.deleteOne({ _id: new ObjectId(id) });
          res.send({ success: true });
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ success: false, message: "Failed to delete image" });
        }
      },
    );

    app.post(
      "/admin/images/bulk-delete",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { ids } = req.body; // array of _id strings
          const objectIds = ids.map((id) => new ObjectId(id));
          await imageCollection.deleteMany({ _id: { $in: objectIds } });
          res.send({ success: true });
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ success: false, message: "Bulk delete failed" });
        }
      },
    );

    // admin plan

    app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalImages = await imageCollection.countDocuments();

        const totalUsers = await usersCollection.countDocuments();

        const totalSubscribers = await paymentCollection.countDocuments({
          pay_for: "subscription",
        });

        const payments = await paymentCollection.find({}).toArray();
        const receivedPayments = payments.reduce(
          (sum, p) => sum + (p.amount || 0),
          0,
        );
        const totalPayments = payments.length;

        res.send({
          totalImages,
          totalSubscribers,
          totalUsers,
          receivedPayments,
          totalPayments,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch admin stats" });
      }
    });

    // -----------payment -> subscription and image payment part---------------------

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

    // for subscription payment

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
      try {
        const { email, amount, transactionId } = req.body;

        let status = "free";
        let planName = "Explorer (Free)";

        if (parseInt(amount) === 999) {
          status = "artist";
          planName = "Artist Plan";
        } else if (parseInt(amount) === 1999) {
          status = "creator";
          planName = "Creator Plan";
        } else if (parseInt(amount) === 0) {
          status = "explorer";
          planName = "Explorer Plan";
        }

        const subscriptionDate = new Date();

        const result = await usersCollection.updateOne(
          { email },
          {
            $set: {
              user_status: status,
              transactionId,
              subscriptionDate,
            },
          },
        );

        // 🔥 ====== EMAIL BODY ====== 🔥
        const mailOptions = {
          from: `"Gallery" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: "🎉 Subscription Successful — Welcome Aboard!",
          html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome to Gallery 🚀</h2>
          <p>Hi there!</p>
          <p>Your subscription has been successfully activated.</p>

          <h3>Subscription Details:</h3>
          <ul>
            <li><strong>Plan:</strong> ${planName}</li>
            <li><strong>Amount Paid:</strong> ৳${amount}</li>
            <li><strong>Transaction ID:</strong> ${transactionId}</li>
            <li><strong>Subscription Date:</strong> ${subscriptionDate.toLocaleString()}</li>
          </ul>

          <p>Thank you for being part of our creative community! 🌟</p>
          <p>— Gallery Team</p>
        </div>
      `,
        };

        // 🔥 Send Email
        await transporter.sendMail(mailOptions);

        res.send({
          success: true,
          message: "User upgraded and email sent successfully",
          result,
        });
      } catch (error) {
        console.error("Email or DB Error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to upgrade or send email",
          error: error.message,
        });
      }
    });

    // ----image payment part----

    app.post("/create-image-payment-intent", async (req, res) => {
      const { amount, buyerEmail, buyerName, sellerEmail, imageId } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: parseInt(amount) * 100,
          currency: "bdt",
          payment_method_types: ["card"],
          metadata: {
            buyerEmail,
            sellerEmail,
            imageId,
          },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Payment creation failed" });
      }
    });

    // purchase image
    app.post("/purchase-image", verifyToken, async (req, res) => {
      const {
        imageId,
        imageName,
        imageLink,
        price,
        buyerEmail,
        buyerName,
        sellerEmail,
        transactionId,
        imageSize,
        category,
      } = req.body;

      const session = client.startSession();
      session.startTransaction();

      try {
        const purchaseDate = new Date();

        // 1) Update IMAGE
        await imageCollection.updateOne(
          { _id: new ObjectId(imageId) },
          {
            $set: { status: "Sold" },
            $push: {
              sold: {
                buyerEmail,
                buyerName,
                boughtAt: purchaseDate,
                transactionId,
              },
            },
          },
          { session },
        );

        // 2) Update USER (buyer)
        await usersCollection.updateOne(
          { email: buyerEmail },
          {
            $push: {
              downloads: {
                imageId,
                imageName,
                imageLink,
                price,
                sellerEmail,
                purchasedAt: purchaseDate,
              },
            },
          },
          { session },
        );

        // 3) Add to PAYMENT collection
        await paymentCollection.insertOne(
          {
            pay_for: "image",
            buyerEmail,
            sellerEmail,
            imageId,
            imageName,
            amount: price,
            transactionId,
            date: purchaseDate,
          },
          { session },
        );

        await session.commitTransaction();

        // 🔥 ====== EMAIL BODY (MOST IMPORTANT PART) ====== 🔥
        const mailOptions = {
          from: `"Gallery" <${process.env.EMAIL_USER}>`,
          to: buyerEmail,
          subject: "🎉 Image Purchase Successful — Thank You!",
          html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>🎉 Congratulations, ${buyerName}! 🎉</h2>
        <p>You have successfully purchased an image from <strong>Gallery</strong>.</p>

        <h3>Purchase Details:</h3>
        <ul>
          <li><strong>Image Name:</strong> ${imageName}</li>
          <li><strong>Price:</strong> ৳${price}</li>
          <li><strong>Seller Email:</strong> ${sellerEmail}</li>
          <li><strong>Transaction ID:</strong> ${transactionId}</li>
          <li><strong>Purchase Date:</strong> ${purchaseDate.toLocaleString()}</li>
          ${
            imageSize
              ? `<li><strong>Image Size:</strong> ${imageSize}</li>`
              : ""
          }
          ${category ? `<li><strong>Category:</strong> ${category}</li>` : ""}
        </ul>

        <p>📥 <a href="${imageLink}" style="color: #2563eb;">
          Click here to download your image
        </a></p>

        <p>Thank you for supporting our creators! 🌟</p>
        <p>— Gallery Team</p>
      </div>
      `,
        };

        // 🔥 Send Email
        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true });
      } catch (error) {
        await session.abortTransaction();
        console.error(error);
        res.status(500).json({ error: "Purchase failed" });
      } finally {
        session.endSession();
      }
    });

    // free download image
    app.post("/download-free-image", verifyToken, async (req, res) => {
      const {
        imageId,
        imageName,
        imageLink,
        buyerEmail,
        buyerName,
        sellerEmail,
      } = req.body;

      const session = client.startSession();
      session.startTransaction();

      try {
        // 1) Update IMAGE
        await imageCollection.updateOne(
          { _id: new ObjectId(imageId) },
          {
            $push: {
              sold: {
                buyerEmail,
                buyerName,
                boughtAt: new Date(),
                transactionId: "FREE_DOWNLOAD",
              },
            },
          },
          { session },
        );

        // 2) Update USER downloads
        await usersCollection.updateOne(
          { email: buyerEmail },
          {
            $push: {
              downloads: {
                imageId,
                imageName,
                imageLink,
                price: 0,
                sellerEmail,
                purchasedAt: new Date(),
              },
            },
          },
          { session },
        );

        // 3) Add to PAYMENT collection
        // await paymentCollection.insertOne(
        //   {
        //     pay_for: "free_image",
        //     buyerEmail,
        //     sellerEmail,
        //     imageId,
        //     imageName,
        //     amount: 0,
        //     transactionId: "FREE_DOWNLOAD",
        //     date: new Date(),
        //   },
        //   { session },
        // );

        await session.commitTransaction();
        res.status(200).json({ success: true });
      } catch (error) {
        await session.abortTransaction();
        console.error(error);
        res.status(500).json({ error: "Free download failed" });
      } finally {
        session.endSession();
      }
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
