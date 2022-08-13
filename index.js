// require express and cors 
const express = require('express');
const cors = require('cors');

// from json web token 
const jwt = require('jsonwebtoken');

// from dotenv 
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// from mongodb 
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// const { application } = require('express');

const stripe = require('stripe')(process.env.SECRET_KEY);

// middleware 
app.use(cors());
app.use(express.json());


// from mongodb 

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hgba3.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// verify token function 
function verifyJwt(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(403).send({ message: "unAuthorized Access" })
    }
    const token = authHeader.split(' ')[1]

    // verify a token symmetric
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(401).send({ message: "Forbidden Access" });
        }
        req.decoded = decoded;
        next();
    });
}

async function run() {
    try {
        await client.connect()
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("booking");
        const userCollection = client.db("doctors_portal").collection("users");
        const doctorCollection = client.db("doctors_portal").collection("doctors");
        const paymentCollection = client.db("doctors_portal").collection("payments");


        // admin api verify 
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        }




        // make an admin api 
        app.put('/user/admin/:email', verifyJwt, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })



        // make an admin api 
        // app.put('/user/admin/:email', verifyJwt, async (req, res) => {
        //     const email = req.params.email;
        //     const requester = req.decoded.email;
        //     const requesterAccount = await userCollection.findOne({ email: requester });
        //     if (requesterAccount.role === 'admin') {
        //         const filter = { email: email };
        //         const updateDoc = {
        //             $set: { role: 'admin' }
        //         };

        //         const result = await userCollection.updateOne(filter, updateDoc);
        //         res.send(result)
        //     }
        //     else {
        //         res.status(403).send({ message: "Forbidden Access" })
        //     }

        // });

        // check admin if not then not allow to make an admin 
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        });

        // user collection and  update if not exist

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };

            const result = await userCollection.updateOne(filter, updateDoc, options);

            // jwt token implement 
            const token = jwt.sign(
                { email: email },
                process.env.ACCESS_TOKEN,
                { expiresIn: '1h' })

            res.send({ result, token })
        });




        // get available service 
        app.get('/available', async (req, res) => {
            const date = req.query.date;
            // step one get all service 
            const services = await serviceCollection.find().toArray();

            // step two get the booking date 
            const query = { date: date }
            const bookings = await bookingCollection.find(query).toArray()

            // step 3 for each service for that service
            services.forEach(service => {
                // step four ..find booking for that service... output: [{},{},{},{}]
                const serviceBookings = bookings.filter(b => b.treatment === service.name)
                // step five select slots for bookings
                const booked = serviceBookings.map(s => s.slot)
                // step six selcet the slots that are not allready booking 
                const available = service.slots.filter(s => !booked.includes(s))
                service.slots = available;
            })

            res.send(services);
        })

        /**
         * API Naming Convention
         * app.get('/booking') // get all bookings in this collection or get more than one filter 
         * app.get('/booking/:id')//get a specific booking
         * app.post('/booking')//add a new booking
         * app.patch('/booking/:id')
         * app.put() update a user if exist or if not exist then add the user..
         * app.delete('/booking/:id')
         *  */

        // get multiple data 
        app.get('/service', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray()
            res.send(services)
        });
        // get method booking all


        // get all users

        app.get('/user', verifyJwt, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })


        app.get('/booking', verifyJwt, async (req, res) => {

            const patient = req.query.patient;
            const decodedMail = req.decoded.email;
            if (patient === decodedMail) {
                // const authorization = req.headers.authorization;
                // console.log(authorization)
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: 'Forbidden Access' })
            }

        })


        // payment api method

        app.post('/create-payment-intent', async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });

            res.json({ clientSecret: paymentIntent.client_secret })
        })

        // update payment methode one 
        app.patch('/booking/:id', verifyJwt, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) }
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment)
            const updateBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updateBooking)
        })





        // payment for booking collection api 

        app.get('/booking/:id', verifyJwt, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query);
            res.json(booking)
        })

        // post method && order for (post)

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            // one user could not booking one time scheulde more than one time in a day.prevent for this query

            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }

            const exists = await bookingCollection.findOne(query)
            const result = await bookingCollection.insertOne(booking);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            else {
                return res.send({ success: true, result })
            }
        });


        // doctor collection api 

        // add doctor api 
        app.post('/doctor', verifyJwt, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        })

        // manage doctor api and get all doctor

        app.get('/doctor', async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })

        // remove a doctor a api 

        app.delete('/doctor/:email', async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter)
            res.send(result);
        })





    }
    finally {

    }
}
run().catch(console.dir)


app.get('/', (req, res) => {
    res.send("Doctors Portal Is Running")
})

app.listen(port, () => {
    console.log("Doctors Portal is listening", port)
})