# MentorLagbe API

## Run locally

Install dependencies with `npm install`, then start the server with `npm run dev`.
Use `npm start` for a non-watching process.

Configure these values in `.env`:

```env
MONGODB_URI=your-mongodb-connection-string
MONGODB_DATABASE=Mentor-lagbe
BETTER_AUTH_URL=http://localhost:3000
CLIENT_ORIGINS=http://localhost:3000,http://localhost:3001
PORT=5000
```

`MONGODB_DATABASE`, `BETTER_AUTH_URL`, `CLIENT_ORIGINS`, and `PORT` have local
defaults. `MONGODB_URI` is required. The API validates sign-in sessions through
Better Auth and allows credentialed requests only from the configured origins.

## Routes

- Public: `GET /api/tuitions` (filters: `q`, `subject`, `level`, `mode`, `page`, `limit`)
- Public: `GET /api/tuitions/:id` (approved, active listings only)
- Public: `GET /api/public/stats` (tutor, student, and active approved tuition counts)
- Tutor: `GET /api/tutor/stats`, `/api/tutor/tuitions`, `/api/tutor/applicants`
- Tutor: `POST /api/tuitions`, `PATCH /api/tuitions/:id`, `DELETE /api/tuitions/:id`
- Student: `GET /api/student/stats`, `/api/student/applications`
- Student: `POST /api/applications`, `DELETE /api/applications/:id`
- Tutor: `PATCH /api/applications/:id`
- Admin: `GET /api/admin/stats`, `/api/admin/users`, `/api/admin/tuitions`, `/api/admin/payments`
- Admin: `PATCH /api/admin/users/:id/role`, `/api/admin/tuitions/:id/approval`

Payments are read from the MongoDB `payments` collection. The current app has no
payment-creation integration, so the transactions list and reported revenue stay
empty/zero until another trusted flow writes payment records.

The old `/api/mentor/*` paths remain aliases for compatibility. Existing users,
tuitions, and applications with the `mentor` role or mentor-prefixed fields are
still supported; new roles and records use `tutor`.
