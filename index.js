const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
// const mongoose = require('mongoose'); //  REMOVED - Not used
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb"); // Import ObjectId
const bcrypt = require("bcrypt");

const app = express();
const port = process.env.PORT || 5000;

const dbId = process.env.DB_ID;
const dbPass = process.env.DB_PASS;

app.use(cors());
app.use(express.json());

//
// --- THIS IS THE MAIN FIX ---
// Changed from double quotes (") to backticks (`)
//
const uri =
  process.env.MONGO_URI ||
  `mongodb+srv://${dbId}:${dbPass}@cluster0.hnylpj5.mongodb.net/sallery?retryWrites=true&w=majority`;

//
// --- REMOVED - This block was not being used ---
//
// mongoose.connect(uri)
//   .then(() => console.log('Connected to MongoDB!'))
//   .catch(err => console.error('Could not connect to MongoDB:', err));

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const database = client.db(); // This correctly points to 'sallery'
    const usersCollection = database.collection("users");
    const studentsCollection = database.collection("students");

    console.log("✅ Connected to MongoDB successfully!");
    console.log(`✅ Writing to database: '${database.databaseName}'`);

    // POST route to register a user
    app.post("/users", async (req, res) => {
      try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        const existingUser = await usersCollection.findOne({ email: email });
        if (existingUser) {
          return res
            .status(400)
            .json({ error: "User with this email already exists" });
        }
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const newUser = {
          username,
          email,
          password: hashedPassword,
        };
        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({
          message: "User registered successfully",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("❌ Error saving user:", err);
        res.status(500).json({ error: "Server error during user registration" });
      }
    });

    // Login route
    app.post("/login", async (req, res) => {
      try {
        const { email, password } = req.body;
        if (!email || !password) {
          return res
            .status(400)
            .json({ error: "Email and password are required" });
        }
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        const userResponse = {
          _id: user._id,
          username: user.username,
          email: user.email,
        };
        res.json({ message: "Login successful", user: userResponse });
      } catch (err) {
        console.error("Error during login:", err);
        res.status(500).json({ error: "Server error during login" });
      }
    });

    // POST route to add a student
    app.post("/students", async (req, res) => {
      try {
        const studentData = req.body;
        if (!studentData || !studentData.name || !studentData.teacherId) {
          return res
            .status(400)
            .json({ error: "Missing required student data" });
        }
        // Add default values for tracking before inserting
        const newStudentData = {
          ...studentData,
          classesConducted: 0,
          paymentStatus: "Unpaid",
          lastPaidDate: null,
          carryOverClasses: 0, // NEW: Initialize carry-over classes
          // Ensure values are numbers
          teachingDays: parseInt(studentData.teachingDays, 10) || 0,
          salary: parseFloat(studentData.salary) || 0,
          transportCost: parseFloat(studentData.transportCost) || 0,
        };
        const result = await studentsCollection.insertOne(newStudentData);
        res.status(201).json({
          message: "Student added successfully",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("❌ Error saving student:", err);
        res
          .status(500)
          .json({ error: "Server error during student creation" });
      }
    });

    // GET route to fetch all students for a specific teacher
    app.get("/students/:teacherId", async (req, res) => {
      try {
        const teacherId = req.params.teacherId;
        const students = await studentsCollection
          .find({ teacherId: teacherId })
          .toArray();
        res.json(students);
      } catch (err) {
        console.error("❌ Error fetching students:", err);
        res
          .status(500)
          .json({ error: "Server error while fetching students" });
      }
    });

    // PATCH route to increment the class count for a student
    app.patch("/students/:studentId/conduct-class", async (req, res) => {
      try {
        const studentId = req.params.studentId;
        if (!ObjectId.isValid(studentId)) {
          return res.status(400).json({ error: "Invalid student ID" });
        }
        
        // --- FIX: Check if student is PAID, not if classes are full ---
        const student = await studentsCollection.findOne({ _id: new ObjectId(studentId) });
        if (!student) {
          return res.status(404).json({ error: "Student not found" });
        }
        // This is the only check we need. We block adding classes *after* they paid.
        if (student.paymentStatus === "Paid") {
            return res.status(400).json({ error: "Student is already marked as paid. Start a new month to add classes." });
        }

        // This increments the class count (e.g., 16 -> 17)
        const result = await studentsCollection.updateOne(
          { _id: new ObjectId(studentId) },
          { $inc: { classesConducted: 1 } }
        );
        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ error: "Student not found or class not updated" });
        }
        res
          .status(200)
          .json({ message: "Class conducted count updated successfully" });
      } catch (err) {
        console.error("❌ Error updating class count:", err);
        res
          .status(500)
          .json({ error: "Server error while updating class count" });
      }
    });

    // PATCH route to mark a student's salary as paid
    app.patch("/students/:studentId/mark-paid", async (req, res) => {
      try {
        const studentId = req.params.studentId;
        if (!ObjectId.isValid(studentId)) {
          return res.status(400).json({ error: "Invalid student ID" });
        }
        
        // First, get the student's current data
        const student = await studentsCollection.findOne({
          _id: new ObjectId(studentId),
        });
        if (!student) {
          return res.status(404).json({ error: "Student not found" });
        }
        
        // This logic is correct.
        // It uses the total classes conducted (e.g., 18)
        const totalConducted = (student.classesConducted || 0);
        // And the monthly target (e.g., 16)
        const teachingDays = student.teachingDays || 0;
        
        // Calculate carry-over classes (18 - 16 = 2)
        let carryOver = 0;
        if (totalConducted > teachingDays) {
          carryOver = totalConducted - teachingDays;
        }

        const result = await studentsCollection.updateOne(
          { _id: new ObjectId(studentId) },
          {
            $set: {
              paymentStatus: "Paid",
              lastPaidDate: new Date(),
              carryOverClasses: carryOver, // Store the calculated carry-over (e.g., 2)
            },
          }
        );
        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ error: "Student not found or payment status not updated" });
        }
        res.status(200).json({ message: "Payment status updated to Paid" });
      } catch (err)
      {
        console.error("❌ Error updating payment status:", err);
        res
          .status(500)
          .json({ error: "Server error while updating payment status" });
      }
    });
    
    // PATCH route to reset for a new month
    app.patch("/students/:studentId/new-month", async (req, res) => {
        try {
            const studentId = req.params.studentId;
            if (!ObjectId.isValid(studentId)) {
              return res.status(400).json({ error: "Invalid student ID" });
            }

            const student = await studentsCollection.findOne({ _id: new ObjectId(studentId) });
            if (!student) {
                return res.status(404).json({ error: "Student not found" });
            }
            
            // This is the logic you wanted:
            // 1. Set status to "Unpaid"
            // 2. Set classesConducted to the carryOverClasses (e.g., 2)
            // 3. Reset carryOverClasses to 0 (since it's been used)
            const result = await studentsCollection.updateOne(
              { _id: new ObjectId(studentId) },
              {
                $set: {
                  paymentStatus: "Unpaid",
                  classesConducted: student.carryOverClasses || 0, // Apply carry-over
                  lastPaidDate: null,
                  carryOverClasses: 0 // Reset carry-over
                },
              }
            );

            if (result.modifiedCount === 0) {
              return res.status(404).json({ error: "Student not found or month not reset" });
            }
            res.status(200).json({ message: "Student reset for new month." });

        } catch (err) {
            console.error("❌ Error resetting for new month:", err);
            res.status(500).json({ error: "Server error while resetting month" });
        }
    });

    // DELETE route to remove a student
    app.delete("/students/:studentId", async (req, res) => {
        try {
            const studentId = req.params.studentId;
            if (!ObjectId.isValid(studentId)) {
              return res.status(400).json({ error: "Invalid student ID" });
            }

            const result = await studentsCollection.deleteOne({ _id: new ObjectId(studentId) });

            if (result.deletedCount === 0) {
                return res.status(404).json({ error: "Student not found" });
            }

            res.status(200).json({ message: "Student deleted successfully" });
        } catch (err) {
            console.error("❌ Error deleting student:", err);
            res.status(500).json({ error: "Server error while deleting student" });
        }
    });

    // This route was not used by the frontend, but the logic is now inside /students/:teacherId
    // I've left it here, but it's not necessary.
    app.get("/salary-tracking/:teacherId", async (req, res) => {
      try {
        const teacherId = req.params.teacherId;
        const students = await studentsCollection
          .find({ teacherId: teacherId })
          .toArray();

        let totalSalary = 0;
        let totalPaid = 0;
        let totalUnpaid = 0;
        const paidStudents = [];
        const unpaidStudents = [];

        students.forEach((student) => {
          const salary = student.salary || 0;
          totalSalary += salary;

          if (student.paymentStatus === "Paid") {
            totalPaid += salary;
            paidStudents.push(student);
          } else {
            totalUnpaid += salary;
            unpaidStudents.push(student);
          }
        });

        res.json({
          totalSalary,
          totalPaid,
          totalUnpaid,
          paidStudents,
          unpaidStudents,
        });
      } catch (err) {
        console.error("❌ Error fetching salary tracking:", err);
        res
          .status(500)
          .json({ error: "Server error while fetching salary tracking" });
      }
    });

    app.get("/", (req, res) => {
      res.send("Backend is running...");
    });
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});