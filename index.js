const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.v7u164c.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decode = await admin.auth().verifyIdToken(token);
    // console.log("decoded token", decode);
    req.decode = decode;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    await client.connect();

    const booksCollection = client.db("inklinkDB").collection("books");
    const borrowedCollection = client
      .db("inklinkDB")
      .collection("borrowedBooks");

    // books api

    // create books data
    app.post("/books", verifyFirebaseToken, async (req, res) => {
      const newBooks = req.body;
      const result = await booksCollection.insertOne(newBooks);
      res.send(result);
    });

    // read books data
    app.get("/books", verifyFirebaseToken, async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    // read category wise books data
    app.get("/catbooks/:category", async (req, res) => {
      const category = req.params.category;
      const result = await booksCollection
        .find({ category: category })
        .toArray();
      res.send(result);
    });

    // read single book data
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.findOne(query);
      res.send(result);
    });

    // update books data
    app.put("/books/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateBook = req.body;
      const updateDoc = {
        $set: updateBook,
      };
      const result = await booksCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // borrowed book data
    app.patch("/books/borrow/:id", async (req, res) => {
      const bookId = req.params.id;
      const { userEmail, userName, returnDate } = req.body;

      try {
        const alreadyBorrowed = await borrowedCollection.findOne({
          bookId: bookId,
          userEmail: userEmail,
          returned: { $ne: true },
        });

        if (alreadyBorrowed) {
          return res.sendStatus(400);
        }

        const book = await booksCollection.findOne({
          _id: new ObjectId(bookId),
        });

        if (!book) {
          return res
            .status(404)
            .json({ success: false, error: "Book not found" });
        }

        if (book.quantity <= 0) {
          return res
            .status(400)
            .json({ success: false, error: "Out of stock" });
        }

        await booksCollection.updateOne(
          { _id: new ObjectId(bookId) },
          { $inc: { quantity: -1 } }
        );

        const borrowInfo = {
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
        };

        await borrowedCollection.insertOne(borrowInfo);

        res.json({ success: true, message: "Book borrowed successfully" });
      } catch (error) {
        console.error("Borrow Error:", error.message);
        res
          .status(500)
          .json({ success: false, error: "Internal server error" });
      }
    });

    // get borrowed books data
    app.get("/borrowedBooks", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;

      if (email !== req.decode.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const result = await borrowedCollection
        .find({ userEmail: email, returned: { $ne: true } })
        .toArray();
      res.send(result);
    });

    // returned borrowed book
    app.patch("/borrowedBooks/return/:id", async (req, res) => {
      const borrowId = req.params.id;
      const { bookId } = req.body;

      try {
        
        await borrowedCollection.updateOne(
          { _id: new ObjectId(borrowId) },
          { $set: { returned: true, returnedAt: new Date() } }
        );

        
        await booksCollection.updateOne(
          { _id: new ObjectId(bookId) },
          { $inc: { quantity: 1 } }
        );

        res.json({ success: true });
      } catch (err) {
        console.error("Return Error:", err);
        res.status(500).json({ success: false, error: "Return failed" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello INK-LINK!");
});

app.listen(port, () => {
  console.log(`INK-LINK listening on port ${port}`);
});
