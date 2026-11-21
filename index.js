import "dotenv/config";
import cors from "cors";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";

// Server and database configuration.
const app = express();
const port = process.env.PORT || 5000;
const authBaseUrl = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
const allowedOrigins = (process.env.CLIENT_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set in mentor-lagbe-server/.env");
}

const client = new MongoClient(uri);
const database = client.db(process.env.MONGODB_DATABASE || "Mentor-lagbe");
const usersCollection = database.collection("user");
const tuitionsCollection = database.collection("tuitions");
const applicationsCollection = database.collection("applications");
const paymentsCollection = database.collection("payments");

// Convert expected API failures into HTTP responses with status codes.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Parse JSON bodies and allow CORS only from configured client origins.
app.use(express.json());
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    req.body = {};
  }
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "Origin is not allowed."));
    },
    credentials: true,
  }),
);

// Normalize legacy "mentor" role values to the current "tutor" role.
const normalizeRole = (role) => {
  if (role === "mentor" || role === "tutor") return "tutor";
  if (role === "admin") return "admin";
  return "student";
};

// Validate MongoDB document IDs before database queries.
const documentId = (value) => {
  if (typeof value !== "string" || !/^[\da-f]{24}$/i.test(value)) {
    throw new HttpError(400, "Invalid document ID.");
  }
  return new ObjectId(value);
};

// Validate required text fields and enforce a maximum length.
const requireText = (value, field, maximumLength = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximumLength) {
    throw new HttpError(400, `${field} is required and must be under ${maximumLength} characters.`);
  }
  return value.trim();
};

// Validate that a banner is an absolute HTTP or HTTPS image URL.
const safeImageUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Banner image is required.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new HttpError(400, "Banner image must be a valid HTTP or HTTPS URL.");
  }
};

// Validate and convert tuition data from an API request.
const tuitionFields = (body) => {
  const fields = {
    title: requireText(body.title, "Title", 160),
    subject: requireText(body.subject, "Subject", 100),
    classLevel: requireText(body.classLevel, "Class level", 100),
    mode: requireText(body.mode, "Mode", 30),
    location: requireText(body.location, "Location", 160),
    monthlyFee: Number(body.monthlyFee),
    daysPerWeek: Number(body.daysPerWeek),
    description: requireText(body.description, "Description"),
    bannerUrl: safeImageUrl(body.bannerUrl),
  };
  if (!["online", "in-person", "offline"].includes(fields.mode)) {
    throw new HttpError(400, "Mode must be online or in-person.");
  }
  if (!Number.isFinite(fields.monthlyFee) || fields.monthlyFee <= 0) {
    throw new HttpError(400, "Monthly fee must be greater than zero.");
  }
  if (!Number.isInteger(fields.daysPerWeek) || fields.daysPerWeek < 1 || fields.daysPerWeek > 7) {
    throw new HttpError(400, "Days per week must be between 1 and 7.");
  }
  if (fields.description.length < 20) {
    throw new HttpError(400, "Description must be at least 20 characters.");
  }
  return fields;
};

// Format a tuition document consistently for API responses.
const mapTuition = (tuition, includeTutorEmail = true) => {
  const tutorName = tuition.tutorName ?? tuition.mentorName;
  const tutorEmail = tuition.tutorEmail ?? tuition.mentorEmail;
  return {
    _id: String(tuition._id),
    title: tuition.title,
    subject: tuition.subject,
    classLevel: tuition.classLevel,
    mode: tuition.mode,
    location: tuition.location,
    monthlyFee: tuition.monthlyFee,
    daysPerWeek: tuition.daysPerWeek,
    description: tuition.description,
    bannerUrl: tuition.bannerUrl,
    approvalStatus: tuition.approvalStatus,
    status: tuition.status,
    tutorName,
    tutorEmail: includeTutorEmail ? tutorEmail : undefined,
    mentorName: tutorName,
    mentorEmail: includeTutorEmail ? tutorEmail : undefined,
  };
};

// Format an application and preserve compatibility with mentor field names.
const mapApplication = (application) => {
  const tutorId = application.tutorId ?? application.mentorId;
  const tutorName = application.tutorName ?? application.mentorName;
  const tutorEmail = application.tutorEmail ?? application.mentorEmail;
  return {
    ...application,
    _id: String(application._id),
    tutorId,
    tutorName,
    tutorEmail,
    mentorId: tutorId,
    mentorName: tutorName,
    mentorEmail: tutorEmail,
  };
};

// Authenticate requests by asking Better Auth to verify the session cookie.
const authenticate = (req, res, next) => {
  const cookie = req.headers.cookie;
  if (!cookie) {
    res.status(401).json({ message: "Please sign in to continue." });
    return;
  }

  fetch(`${authBaseUrl}/api/auth/get-session`, {
    headers: { cookie, accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new HttpError(502, "Could not verify the sign-in session.");
      }
      const session = await response.json();
      if (!session?.user?.id) {
        res.status(401).json({ message: "Please sign in to continue." });
        return;
      }
      req.user = {
        ...session.user,
        id: String(session.user.id),
        role: normalizeRole(session.user.role),
      };
      next();
    })
    .catch(next);
};

// Middleware factory that limits a route to a specific user role.
const requireRole = (role) =>
  (req, res, next) => {
    if (req.user.role !== role) {
      res.status(403).json({ message: "You do not have permission to perform this action." });
      return;
    }
    next();
  };

// Check whether the signed-in tutor owns a tuition or application.
const isOwner = (document, user) => {
  return (document.tutorId ?? document.mentorId) === user.id;
};

// Escape search text so it is interpreted literally in a MongoDB regular expression.
const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Health check for confirming that the server is running.
app.get("/", (req, res) => {
  res.send("MentorLagbe server running");
});

// Public dashboard totals for tutors, students, and live tuitions.
app.get("/api/public/stats", async (req, res) => {
  const [tutorCount, studentCount, liveTuitions] = await Promise.all([
    usersCollection.countDocuments({ role: { $in: ["tutor", "mentor"] } }),
    usersCollection.countDocuments({
      $or: [{ role: "student" }, { role: { $exists: false } }],
    }),
    tuitionsCollection.countDocuments({
      approvalStatus: "approved",
      status: "active",
    }),
  ]);
  res.json({ tutorCount, studentCount, liveTuitions });
});

// Public tuition listing with pagination, search, subject, level, and mode filters.
app.get("/api/tuitions", async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 9));
  const filters = { approvalStatus: "approved", status: "active" };
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const level = typeof req.query.level === "string" ? req.query.level.trim() : "";
  const mode = typeof req.query.mode === "string" ? req.query.mode.trim().toLowerCase() : "";

  if (search) {
    const expression = new RegExp(escapeRegex(search), "i");
    filters.$or = [
      { title: expression },
      { subject: expression },
      { description: expression },
      { location: expression },
    ];
  }
  if (subject) filters.subject = new RegExp(`^${escapeRegex(subject)}$`, "i");
  if (level) filters.classLevel = new RegExp(`^${escapeRegex(level)}$`, "i");
  if (mode === "offline") filters.mode = { $in: ["in-person", "offline"] };
  else if (mode) filters.mode = mode;

  const [total, tuitions] = await Promise.all([
    tuitionsCollection.countDocuments(filters),
    tuitionsCollection
      .find(filters)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);
  res.json({
    tuitions: tuitions.map((tuition) => mapTuition(tuition, false)),
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

// Public details for one approved and active tuition.
app.get("/api/tuitions/:id", async (req, res) => {
  const tuition = await tuitionsCollection.findOne({
    _id: documentId(req.params.id),
    approvalStatus: "approved",
    status: "active",
  });
  if (!tuition) throw new HttpError(404, "Tuition not found.");
  res.json(mapTuition(tuition, false));
});

// Tutor-only tuition creation; free tutors are limited to two posts.
app.post("/api/tuitions", authenticate, requireRole("tutor"), async (req, res) => {
  const user = await usersCollection.findOne({ _id: documentId(req.user.id) });
  const plan = user?.plan === "pro" ? "pro" : "free";
  const tutorTuitions = { $or: [{ tutorId: req.user.id }, { mentorId: req.user.id }] };
  if (plan === "free" && (await tuitionsCollection.countDocuments(tutorTuitions)) >= 2) {
    throw new HttpError(403, "Free plan tutors can post up to 2 tuitions.");
  }

  const tuition = {
    ...tuitionFields(req.body),
    tutorId: req.user.id,
    tutorName: req.user.name,
    tutorEmail: req.user.email,
    approvalStatus: "pending",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await tuitionsCollection.insertOne(tuition);
  res.status(201).json({ _id: String(result.insertedId) });
});

// Tutor dashboard statistics.
app.get(["/api/tutor/stats", "/api/mentor/stats"], authenticate, requireRole("tutor"), async (req, res) => {
  const [tuitions, user] = await Promise.all([
    tuitionsCollection.find({ $or: [{ tutorId: req.user.id }, { mentorId: req.user.id }] }).toArray(),
    usersCollection.findOne({ _id: documentId(req.user.id) }, { projection: { plan: 1 } }),
  ]);
  const applicants = await applicationsCollection.countDocuments({
    $or: [{ tutorId: req.user.id }, { mentorId: req.user.id }],
  });
  res.json({
    totalTuitions: tuitions.length,
    approved: tuitions.filter((tuition) => tuition.approvalStatus === "approved").length,
    applicants,
    plan: user?.plan === "pro" ? "pro" : "free",
  });
});

// List all tuitions created by the signed-in tutor.
app.get(["/api/tutor/tuitions", "/api/mentor/tuitions"], authenticate, requireRole("tutor"), async (req, res) => {
  const tuitions = await tuitionsCollection
    .find({ $or: [{ tutorId: req.user.id }, { mentorId: req.user.id }] })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(tuitions.map(mapTuition));
});

// List applications submitted to tuitions owned by the signed-in tutor.
app.get(["/api/tutor/applicants", "/api/mentor/applicants"], authenticate, requireRole("tutor"), async (req, res) => {
  const applications = await applicationsCollection
    .find({ $or: [{ tutorId: req.user.id }, { mentorId: req.user.id }] })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(applications.map(mapApplication));
});

// Tutor-only tuition editing, ownership checking, and reapproval handling.
app.patch("/api/tuitions/:id", authenticate, requireRole("tutor"), async (req, res) => {
  const tuitionId = documentId(req.params.id);
  const tuition = await tuitionsCollection.findOne({ _id: tuitionId });
  if (!tuition) throw new HttpError(404, "Tuition not found.");
  if (!isOwner(tuition, req.user)) throw new HttpError(403, "You cannot edit this tuition.");
  if (Object.hasOwn(req.body, "approvalStatus")) {
    throw new HttpError(400, "Only an admin can change tuition approval.");
  }

  const changes = {};
  if (Object.hasOwn(req.body, "status")) {
    if (!["active", "closed"].includes(req.body.status)) {
      throw new HttpError(400, "Status must be active or closed.");
    }
    changes.status = req.body.status;
  }
  const editableFields = ["title", "subject", "classLevel", "mode", "location", "monthlyFee", "daysPerWeek", "description", "bannerUrl"];
  if (editableFields.some((field) => Object.hasOwn(req.body, field))) {
    const updatedFields = tuitionFields({ ...tuition, ...req.body });
    Object.assign(changes, updatedFields);
    const detailsChanged = editableFields.some((field) => updatedFields[field] !== tuition[field]);
    if (detailsChanged) changes.approvalStatus = "pending";
  }
  if (!Object.keys(changes).length) throw new HttpError(400, "No changes were provided.");

  await tuitionsCollection.updateOne(
    { _id: tuitionId },
    { $set: { ...changes, updatedAt: new Date() } },
  );
  res.json({ message: "Tuition updated." });
});

// Tutor-only deletion of a tuition owned by the signed-in user.
app.delete("/api/tuitions/:id", authenticate, requireRole("tutor"), async (req, res) => {
  const tuitionId = documentId(req.params.id);
  const tuition = await tuitionsCollection.findOne({ _id: tuitionId });
  if (!tuition) throw new HttpError(404, "Tuition not found.");
  if (!isOwner(tuition, req.user)) throw new HttpError(403, "You cannot delete this tuition.");
  await tuitionsCollection.deleteOne({ _id: tuitionId });
  res.json({ message: "Tuition deleted." });
});

// Student application submission with duplicate and availability checks.
app.post("/api/applications", authenticate, requireRole("student"), async (req, res) => {
  const tuition = await tuitionsCollection.findOne({
    _id: documentId(req.body.tuitionId),
    approvalStatus: "approved",
    status: "active",
  });
  if (!tuition) throw new HttpError(404, "This tuition is not available for applications.");
  if (await applicationsCollection.findOne({ tuitionId: String(tuition._id), studentId: req.user.id })) {
    throw new HttpError(409, "You have already applied to this tuition.");
  }

  const application = {
    tuitionId: String(tuition._id),
    tuitionTitle: tuition.title,
    tutorId: tuition.tutorId ?? tuition.mentorId,
    tutorName: tuition.tutorName ?? tuition.mentorName,
    tutorEmail: tuition.tutorEmail ?? tuition.mentorEmail,
    monthlyFee: tuition.monthlyFee,
    studentId: req.user.id,
    studentName: req.user.name,
    studentEmail: req.user.email,
    phone: requireText(req.body.phone, "Phone number", 40),
    schedule: requireText(req.body.schedule, "Schedule", 300),
    note: typeof req.body.note === "string" ? req.body.note.trim().slice(0, 2000) : "",
    status: "pending",
    createdAt: new Date(),
  };
  const result = await applicationsCollection.insertOne(application);
  res.status(201).json({ _id: String(result.insertedId) });
});

// Student application history.
app.get("/api/student/applications", authenticate, requireRole("student"), async (req, res) => {
  const applications = await applicationsCollection
    .find({ studentId: req.user.id })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(applications.map(mapApplication));
});

// Student dashboard statistics.
app.get("/api/student/stats", authenticate, requireRole("student"), async (req, res) => {
  const [applications, user] = await Promise.all([
    applicationsCollection.find({ studentId: req.user.id }).toArray(),
    usersCollection.findOne({ _id: documentId(req.user.id) }, { projection: { plan: 1 } }),
  ]);
  res.json({
    total: applications.length,
    accepted: applications.filter((application) => application.status === "accepted").length,
    pending: applications.filter((application) => application.status === "pending").length,
    plan: user?.plan === "pro" ? "pro" : "free",
  });
});

// Tutor review of a pending application owned by that tutor.
app.patch("/api/applications/:id", authenticate, requireRole("tutor"), async (req, res) => {
  const status = req.body.status;
  if (!["accepted", "rejected"].includes(status)) {
    throw new HttpError(400, "Status must be accepted or rejected.");
  }
  const applicationId = documentId(req.params.id);
  const application = await applicationsCollection.findOne({ _id: applicationId });
  if (!application) throw new HttpError(404, "Application not found.");
  if (!isOwner(application, req.user)) {
    throw new HttpError(403, "You cannot update this application.");
  }
  if (application.status !== "pending") {
    throw new HttpError(409, "Only pending applications can be reviewed.");
  }
  const result = await applicationsCollection.updateOne(
    {
      _id: applicationId,
      status: "pending",
      $or: [{ tutorId: req.user.id }, { mentorId: req.user.id }],
    },
    { $set: { status } },
  );
  if (!result.matchedCount) throw new HttpError(409, "This application has already been reviewed.");
  res.json({ message: "Application updated." });
});

// Student cancellation of a pending application.
app.delete("/api/applications/:id", authenticate, requireRole("student"), async (req, res) => {
  const applicationId = documentId(req.params.id);
  const application = await applicationsCollection.findOne({ _id: applicationId });
  if (!application) throw new HttpError(404, "Application not found.");
  if (application.studentId !== req.user.id) {
    throw new HttpError(403, "You cannot cancel this application.");
  }
  if (application.status !== "pending") {
    throw new HttpError(409, "Only pending applications can be cancelled.");
  }
  const result = await applicationsCollection.deleteOne({
    _id: applicationId,
    studentId: req.user.id,
    status: "pending",
  });
  if (!result.deletedCount) throw new HttpError(409, "This application can no longer be cancelled.");
  res.json({ message: "Application cancelled." });
});

// Admin dashboard totals and payment revenue.
app.get("/api/admin/stats", authenticate, requireRole("admin"), async (req, res) => {
  const [totalUsers, totalTutors, pendingTuitions, approvedTuitions, paymentTotals] = await Promise.all([
    usersCollection.countDocuments(),
    usersCollection.countDocuments({ role: { $in: ["mentor", "tutor"] } }),
    tuitionsCollection.countDocuments({ approvalStatus: "pending" }),
    tuitionsCollection.countDocuments({ approvalStatus: "approved" }),
    paymentsCollection
      .aggregate([
        {
          $group: {
            _id: null,
            revenue: {
              $sum: {
                $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 },
              },
            },
          },
        },
      ])
      .next(),
  ]);
  res.json({
    totalUsers,
    totalTutors,
    totalMentors: totalTutors,
    pendingTuitions,
    approvedTuitions,
    revenue: paymentTotals?.revenue ?? 0,
  });
});

// Admin user directory.
app.get("/api/admin/users", authenticate, requireRole("admin"), async (req, res) => {
  const users = await usersCollection.find({}, { projection: { name: 1, email: 1, role: 1 } }).toArray();
  res.json(
    users.map((user) => ({
      _id: String(user._id),
      name: user.name,
      email: user.email,
      role: normalizeRole(user.role),
    })),
  );
});

// Admin role management.
app.patch("/api/admin/users/:id/role", authenticate, requireRole("admin"), async (req, res) => {
  const { role } = req.body;
  if (!["student", "tutor", "mentor", "admin"].includes(role)) {
    throw new HttpError(400, "Role must be student, tutor, or admin.");
  }
  const normalizedRole = normalizeRole(role);
  const userId = documentId(req.params.id);
  if (String(userId) === req.user.id) throw new HttpError(400, "You cannot change your own role.");
  const result = await usersCollection.updateOne({ _id: userId }, { $set: { role: normalizedRole } });
  if (!result.matchedCount) throw new HttpError(404, "User not found.");
  res.json({ message: "Role updated." });
});

// Admin list of every tuition, including pending and rejected entries.
app.get("/api/admin/tuitions", authenticate, requireRole("admin"), async (req, res) => {
  const tuitions = await tuitionsCollection.find().sort({ createdAt: -1 }).toArray();
  res.json(tuitions.map(mapTuition));
});

// Admin approval or rejection of a tuition.
app.patch("/api/admin/tuitions/:id/approval", authenticate, requireRole("admin"), async (req, res) => {
  const { approvalStatus } = req.body;
  if (!["approved", "rejected"].includes(approvalStatus)) {
    throw new HttpError(400, "Approval status must be approved or rejected.");
  }
  const result = await tuitionsCollection.updateOne(
    { _id: documentId(req.params.id) },
    { $set: { approvalStatus, updatedAt: new Date() } },
  );
  if (!result.matchedCount) throw new HttpError(404, "Tuition not found.");
  res.json({ message: "Tuition approval updated." });
});

// Admin payment and revenue transaction history.
app.get("/api/admin/payments", authenticate, requireRole("admin"), async (req, res) => {
  const payments = await paymentsCollection.find().sort({ paidAt: -1 }).toArray();
  res.json(
    payments.map((payment) => ({
      _id: String(payment._id),
      userName: payment.userName,
      email: payment.email,
      role: normalizeRole(payment.role),
      plan: payment.plan,
      amount: payment.amount,
      transactionId: payment.transactionId,
      paidAt: payment.paidAt,
    })),
  );
});

// Central error handler for validation, authentication, database, and unexpected errors.
// app.use((error, req, res, next) => {
//   if (res.headersSent) {
//     next(error);
//     return;
//   }
//   if (error instanceof HttpError) {
//     res.status(error.status).json({ message: error.message });
//     return;
//   }
//   if (error.type === "entity.parse.failed") {
//     res.status(400).json({ message: "Request body must be valid JSON." });
//     return;
//   }
//   console.error("API request failed:", error);
//   res.status(500).json({ message: "An unexpected server error occurred." });
// });

// Start MongoDB, then begin listening for HTTP requests.
try {
  await client.connect();
  console.log("Connected to MongoDB");
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
} catch (error) {
  console.error("Error connecting to MongoDB:", error);
  process.exit(1);
}
