const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// Firebase admin init
const serviceAccount = require("./firebase-admin-service-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// verify token middleware
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decode = await admin.auth().verifyIdToken(token);
    req.decode = decode;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

// Mongo URI (use only atlas in production ideally)
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.v7u164c.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let booksCollection;
let borrowedCollection;

// DB connection (serverless safe)
async function connectDB() {
  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
    const db = client.db("inklinkDB");
    booksCollection = db.collection("books");
    borrowedCollection = db.collection("borrowedBooks");
    console.log("✅ Mongo connected");
  }
}

// ensure DB connected
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).send("DB connection failed");
  }
});

// root
app.get("/", (req, res) => {
  res.send("Hello INK-LINK!");
});

// ================= ROUTES =================

// create book
app.post("/books", verifyFirebaseToken, async (req, res) => {
  const result = await booksCollection.insertOne(req.body);
  res.send(result);
});

// get all books
app.get("/books", verifyFirebaseToken, async (req, res) => {
  const result = await booksCollection.find().toArray();
  res.send(result);
});

// category books
app.get("/catbooks/:category", async (req, res) => {
  const result = await booksCollection
    .find({ category: req.params.category })
    .toArray();
  res.send(result);
});

// single book
app.get("/books/:id", async (req, res) => {
  const result = await booksCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  res.send(result);
});

// update book
app.put("/books/:id", async (req, res) => {
  const result = await booksCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body },
    { upsert: true }
  );
  res.send(result);
});

// borrow book
app.patch("/books/borrow/:id", async (req, res) => {
  const { userEmail, userName, returnDate } = req.body;
  const bookId = req.params.id;

  try {
    const alreadyBorrowed = await borrowedCollection.findOne({
      bookId,
      userEmail,
      returned: { $ne: true },
    });

    if (alreadyBorrowed) return res.sendStatus(400);

    const book = await booksCollection.findOne({
      _id: new ObjectId(bookId),
    });

    if (!book)
      return res.status(404).json({ error: "Book not found" });

    if (book.quantity <= 0)
      return res.status(400).json({ error: "Out of stock" });

    await booksCollection.updateOne(
      { _id: new ObjectId(bookId) },
      { $inc: { quantity: -1 } }
    );

    await borrowedCollection.insertOne({
      bookId,
      userEmail,
      userName,
      borrowedDate: new Date(),
      returnDate,
      returned: false,
      name: book.name,
      author: book.author,
      category: book.category,
      image: book.image,
      rating: book.rating,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Borrow failed" });
  }
});

// borrowed books
app.get("/borrowedBooks", verifyFirebaseToken, async (req, res) => {
  const email = req.query.email;

  if (email !== req.decode.email) {
    return res.status(403).send({ message: "forbidden" });
  }

  const result = await borrowedCollection
    .find({ userEmail: email, returned: { $ne: true } })
    .toArray();

  res.send(result);
});

// return book
app.patch("/borrowedBooks/return/:id", async (req, res) => {
  const { bookId } = req.body;

  try {
    await borrowedCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { returned: true, returnedAt: new Date() } }
    );

    await booksCollection.updateOne(
      { _id: new ObjectId(bookId) },
      { $inc: { quantity: 1 } }
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Return failed" });
  }
});

// export for Vercel
export default app;