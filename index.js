const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// app.use(cors());
// middleware
app.use(express.json());
app.use(cors());

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const tokenId = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(tokenId);
    req.decoded_email = decoded.email;
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  next();
};

const stripe = require("stripe")(process.env.STRIPE_KEY);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.j7xeedk.mongodb.net/?appName=Cluster0`;
const YOUR_DOMAIN = process.env.SITE_DOMAIN;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

function generateTrackingId() {
  const timestamp = Date.now().toString(36); // base36 timestamp
  const random = crypto.randomBytes(4).toString("hex");
  return `TRK-${timestamp}-${random}`;
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const myDB = client.db("siftingHobe");
    const parcelCollection = myDB.collection("parcels");
    const paymentCollection = myDB.collection("payments");
    const userCollection = myDB.collection("users");
    const ridersCollection = myDB.collection("riders");
    //admin token
    const verifyAdminToken = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden" });
      }

      next();
    };
    //users api's

    app.get("/users", verifyToken, async (req, res) => {
      const searchPerson = req.query.searchPerson;
      console.log(searchPerson);

      let query = {};

      if (searchPerson) {
        query = {
          $or: [
            { name: { $regex: searchPerson, $options: "i" } },
            { email: { $regex: searchPerson, $options: "i" } },
          ],
        };
      }

      const cursor = userCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(4);

      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {});
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });
    app.post("/users", async (req, res) => {
      const user = req.body;
      // console.log(user);

      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user Exists" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyToken,
      verifyAdminToken,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    //riders api's
    app.get("/riders", async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      if (district) {
        query.district = district;
      }
      if (status) {
        query.status = status;
      }
      if (workStatus) {
        query.workStatus = workStatus;
      }
      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch("/riders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
          workStatus: "available",
        },
      };
      const result = await ridersCollection.updateOne(query, updatedDoc);
      if (status === "approved") {
        const email = req.body.email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "rider",
          },
        };
        const userResult = await userCollection.updateOne(
          userQuery,
          updateUser
        );
      }
      res.send(result);
    });

    //=================api's================
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email, deliveryStatus } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }

      const options = { sort: { createTime: -1 } };
      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/rider", async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {};
      if (riderEmail) {
        query.riderEmail = riderEmail;
      }
      if (deliveryStatus) {
        query.deliveryStatus = { $in: ["driver-assigned", "rider-on-the-way"] };
      }
      const cursor = parcelCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createTime = new Date();
      parcel.paymentStatus = parcel.paymentStatus || "pending";
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.patch("/parcels/:id", async (req, res) => {
      const { parcelId, riderId, riderName, riderEmail } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          deliveryStatus: "driver-assigned",
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail,
        },
      };
      const result = await parcelCollection.updateOne(query, updatedDoc);
      const riderQuery = { _id: new ObjectId(riderId) };
      const riderUpdateDoc = {
        $set: {
          workStatus: "going-for-pickup",
        },
      };
      const riderResult = await ridersCollection.updateOne(
        riderQuery,
        riderUpdateDoc
      );
    });

    app.patch("/parcels/:id/status", async (req, res) => {
      const { deliveryStatus } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus,
        },
      };
      const result = await parcelCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = paymentInfo.deliveryCost * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              product_data: {
                name: paymentInfo.parcelName,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${YOUR_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${YOUR_DOMAIN}/dashboard/payment-canceled`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const trackingId = generateTrackingId();
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExits = await paymentCollection.findOne(query);
      if (paymentExits) {
        return;
      }
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: "pending-pickup",
            trackingId: trackingId,
          },
        };
        await parcelCollection.updateOne(query, update);

        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customer_email: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(
            paymentHistory
          );
          res.send({
            success: true,
            paymentInfo: resultPayment,
            transactionId: session.payment_intent,
            trackingId: trackingId,
          });
        }
        res.send({
          success: true,
        });
      }

      res.send({
        success: false,
      });
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/payments", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.customer_email = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
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
  res.send("Home-delivery");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
