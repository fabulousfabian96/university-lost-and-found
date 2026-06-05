# University of Kabianga Lost & Found System

A Node.js and Express application for managing lost items at University of Kabianga.

## Features
- Separate login flows for `admin`, `security`, and `user`
- Users can report lost items with optional image upload
- Security approves or rejects claim requests
- Notifications sent to claimants after security verification
- Admin can view users and item records, and create new accounts

## Setup
1. Copy `.env.example` to `.env` and set your MySQL credentials and SMTP settings.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Seed the database and create default accounts:
   ```bash
   npm run seed
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open in browser:
   ```
   http://localhost:3000
   ```

## Email Notifications
The system sends email updates when:
- a claim request is submitted
- a claim is approved
- a claim is rejected

Set the following values in `.env`:
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_SECURE`
- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_FROM`

## Deployment
This app is ready to deploy on platforms like Render, Railway, or Heroku.

### Render deployment
1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Create a new service on Render and connect your repo.
3. Choose the `master` branch and set the build command to:
   ```bash
   npm install
   ```
4. Set the start command to:
   ```bash
   npm start
   ```
5. Create a managed MySQL database on Render, with database name `kabianga_lost_and_found`.
6. In Render service settings, add these environment variables:
   - `DB_HOST`
   - `DB_PORT`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME=kabianga_lost_and_found`
   - `SESSION_SECRET`
   - `EMAIL_HOST`
   - `EMAIL_PORT`
   - `EMAIL_SECURE`
   - `EMAIL_USER`
   - `EMAIL_PASS`
   - `EMAIL_FROM`
7. If Render provides `DATABASE_URL`, the app will also use it automatically.

### Docker deployment
A `Dockerfile` and `docker-compose.yml` are included for local or cloud container deployment.

To run locally with Docker:
```bash
docker compose up --build
```

Then open:
```bash
http://localhost:3000
```

## Default accounts
- Admin: `admin@kabianga.ac.ke` / `AdminPass123`
- Security: `security@kabianga.ac.ke` / `SecurityPass123`

## Notes
- Uploads are stored in `public/uploads`
- Use the admin dashboard to add additional security or admin users
