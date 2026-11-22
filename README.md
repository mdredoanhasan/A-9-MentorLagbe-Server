# MentorLagbe (Server)

REST API for MentorLagbe, a smart tuition and mentorship platform that connects students with tutors and lets admins moderate every listing.

This repository is the **Express server**. The Next.js client lives in a separate repository (see Links).

## Purpose

The API stores tuitions, applications and payments in MongoDB, checks who is signed in, and makes sure each role (student, tutor, admin) can only do what it is allowed to do.

## Links

| What | Link |
|---|---|
| Live API | https://mentor-lagbe-server-chi.vercel.app |
| Live site | https://mentor-lagbe-client-beta.vercel.app/ |
| Server repository | https://github.com/mdredoanhasan/A-9-MentorLagbe-Server |
| Client repository | https://github.com/mdredoanhasan/A-9-MentorLagbe-client |

## Test Accounts

| Role | Email | Password |
|---|---|---|
| Admin | `<add admin email>` | `<add admin password>` |
| Tutor | `<add tutor email>` | `<add tutor password>` |
| Student | `<add student email>` | `<add student password>` |

## Key Features

- Public tuition listing with server-side search, filters (subject, class level, mode) and pagination
- Tutors can create, edit, delete and open or close their own tuitions
- Free plan tutors are limited to 2 tuition posts
- Edited tuition details go back to pending for admin review
- Students can apply once per tuition and cancel pending applications
- Tutors can accept or reject applications for their own tuitions
- Admin routes for statistics, user roles, tuition approval and payments
- Role-based access control on every protected route (401 when not signed in, 403 for the wrong role)
- Input validation and a central error handler
- CORS limited to the configured client origins

## API Overview

**Public**

| Method | Route | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/api/public/stats` | Tutor, student and live tuition counts |
| GET | `/api/tuitions` | Approved tuitions (`q`, `subject`, `level`, `mode`, `page`, `limit`) |
| GET | `/api/tuitions/:id` | One approved tuition |

**Tutor**

| Method | Route | Description |
|---|---|---|
| POST | `/api/tuitions` | Create a tuition |
| PATCH | `/api/tuitions/:id` | Edit or open/close own tuition |
| DELETE | `/api/tuitions/:id` | Delete own tuition |
| GET | `/api/tutor/stats` | Dashboard numbers |
| GET | `/api/tutor/tuitions` | Own tuitions |
| GET | `/api/tutor/applicants` | Applications received |
| PATCH | `/api/applications/:id` | Accept or reject an application |

**Student**

| Method | Route | Description |
|---|---|---|
| POST | `/api/applications` | Apply to a tuition |
| GET | `/api/student/applications` | Own applications |
| GET | `/api/student/stats` | Dashboard numbers |
| DELETE | `/api/applications/:id` | Cancel a pending application |

**Admin**

| Method | Route | Description |
|---|---|---|
| GET | `/api/admin/stats` | Platform statistics |
| GET | `/api/admin/users` | All users |
| PATCH | `/api/admin/users/:id/role` | Change a user's role |
| GET | `/api/admin/tuitions` | All tuitions |
| PATCH | `/api/admin/tuitions/:id/approval` | Approve or reject a tuition |
| GET | `/api/admin/payments` | Payment transactions |

## Tech Stack

- Node.js
- Express
- MongoDB (native driver)
- Deployed on Vercel

## npm Packages Used

- `express`
- `cors`
- `dotenv`
- `mongodb`

## Environment Variables

Create a `.env` file in the project root. Never commit it.

```env
PORT=5000
MONGODB_URI=
MONGODB_DATABASE=
CLIENT_ORIGINS=
BETTER_AUTH_URL=
```

`CLIENT_ORIGINS` is a comma-separated list of allowed client URLs, for example the live client URL and `http://localhost:3000`.

## Run Locally

```bash
git clone https://github.com/mdredoanhasan/A-9-MentorLagbe-Server.git
cd A-9-MentorLagbe-Server
npm install
node index.js
```

The server starts on http://localhost:5000.

## Author

Redoan Hasan
GitHub: https://github.com/mdredoanhasan
