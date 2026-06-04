# Chinab Apartment Society App

This is the first database-driven prototype for a simple society maintenance app.

## What is included

- Resident mobile-style portal
- Admin dashboard
- Demo data for 850 flats
- Maintenance dues and manual payment status
- Complaint creation and admin status update
- Society notices
- Basic collection and pending dues reports
- Local SQLite database
- Node API for resident/admin data
- Block master creation
- Flat master creation
- Resident update for each flat

## How to open

Start the app server:

```powershell
npm start
```

Then open:

`http://localhost:4173`

No package installation is required. The database uses Node's built-in SQLite support and is created at:

`D:\sandeep\Codex\data\chinab-society.db`

## Make it live for testing

Use this when testers are in different locations and your PC should be off.

### 1. Push code to GitHub

Create a GitHub repository and upload this project folder.

### 2. Deploy on Render

1. Open `https://render.com`
2. Create an account or sign in
3. Click **New +**
4. Choose **Web Service**
5. Connect your GitHub repository
6. Use these settings:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variable: `NODE_VERSION=22`
7. Deploy

Render will give you a public URL like:

`https://chinab-apartment-society.onrender.com`

Share that URL with testers.

### Important for live testing

This version still uses SQLite. It is okay for a small demo, but for serious testing with many users, move the database to Supabase/PostgreSQL so data is safer and easier to back up.

## Demo login

- Resident: select a flat, enter the registered mobile number, then enter the PIN. Default PIN is the last 4 digits of the registered mobile number.
- Admin username: `admin`
- Admin password: `admin123`

## Next phase

- Convert to Flutter Android app or React Native
- Import real flat owner data from Excel
- Add OTP login
- Move database to Firebase/Supabase/PostgreSQL when ready for production
- Add Razorpay/UPI payment
- Add PDF receipts and Excel reports
