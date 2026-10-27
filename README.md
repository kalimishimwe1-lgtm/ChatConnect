# Chat Connect

## Test Usage
To explore and test Chat Connect, you can visit the following link:

👉 Explore the live chat: [Chat Connect Demo](https://chat-connect-ps95.onrender.com/)

## Setting Up `.env` File for Chat-Connect Application

Follow these steps to set up the `.env` file for the Chat-Connect application:

1. **Create the `.env` File**: If you haven't already, copy `.env.example` to `.env` in the root directory of your Chat-Connect application.

2. **Define Environment Variables**:

The example file is configured for local Docker Compose. Set these values in `.env`:

```plaintext
DATABASE_URL="postgresql://chatconnect:chatconnect@postgres:5432/chatconnect"
SECRET="a-long-random-secret"
```

For a hosted database, create a PostgreSQL database with your provider and set `DATABASE_URL` to its connection string. Neon’s Free plan is one option for small projects; it has usage limits and may scale to zero. Keep connection strings and `SECRET` private, and do not commit `.env`.
---

## Quick Start Guide

To execute the code from the GitHub repository, follow these steps:

1. **Clone Repository**:
   ```bash
   git clone https://github.com/Rds2151/ChatConnect.git
   ```

2. **Navigate to Directory**:
   ```bash
   cd ChatConnect
   ```

3. **Run Docker Compose**:

   ```bash
   docker-compose up
   ```

   If you want to run it in detached mode, use:
   ```bash
   docker-compose up -d
   ```

4. **Stop Docker Compose**:

   ```bash
   docker-compose down
   ```

5. **Access Application**:

   Open your web browser and go to `http://localhost:3000`.

That's it! You're ready to use the application. If you encounter any issues, feel free to ask for help.

--- 

## Database

The app uses PostgreSQL for users, direct and group chat messages, private groups, group membership, and Express sessions. On startup it creates the required tables; the PostgreSQL session store creates its table automatically. Database queries use parameters to avoid SQL injection.

For local development, `docker-compose up --build` starts the app and PostgreSQL. The PostgreSQL volume preserves local data across container restarts. New accounts can be created from the registration page.

For Render, set `DATABASE_URL` to the external PostgreSQL provider’s pooled connection string (for Neon, copy it from the Neon dashboard) and `SECRET` to a strong random value. Chat delivery uses in-process Socket.IO connections, so deploy a single application instance; multiple instances require a shared Socket.IO adapter.

This migration does not copy existing MongoDB records. Create accounts again in the PostgreSQL-backed app or migrate data separately if a MongoDB database contains records you need.

## User roles and access

Accounts are regular users by default. To bootstrap administrators, set the server-only `ADMIN_CONTACT_NOS` environment variable to a comma-separated list of contact numbers for existing accounts before starting the app (for example, `ADMIN_CONTACT_NOS=15551234567`). The database startup migration promotes those accounts and re-enables them. On Render, set this in the service's environment settings; do not expose it in browser code.

Administrators can use **Manage users and access** to promote or demote users and enable or disable accounts. A disabled account cannot sign in, chat, or join calls; its connected sockets are disconnected immediately. Administrators cannot change their own access, and at least one active administrator must remain. Remove contact numbers from `ADMIN_CONTACT_NOS` after bootstrapping if you do not want startup to restore those accounts as administrators.

## Private group chats

Sign in, open **Create a private group**, enter a group name, and select at least one registered member. The creator is included automatically. Only members can load or send group messages; individual one-to-one chats remain available separately. Group membership and messages are stored in PostgreSQL.

## Profiles, presence, and search

Use **Edit profile** to change your display name, about message, and profile picture. Profile pictures accept JPEG, PNG, GIF, or WebP files up to 2 MB; changes update connected users and existing direct-chat history. Choose **Online** or **Away** from the profile status menu; signing out or disconnecting your final active chat session marks you offline. Search contacts, private groups, and text messages from the search field. Group search and message results are restricted to groups the signed-in user belongs to.

## Audio and video calls, and voice notes

Start an audio or video call from an open direct chat or private group. Group calls support up to 15 participants using peer-to-peer connections; performance depends on participants' devices and networks. Calls use a public STUN server by default. For networks that require a relay, configure `TURN_URLS` as a comma-separated list of TURN server URLs and `TURN_SHARED_SECRET` with the server's shared secret. The app issues time-limited TURN credentials to signed-in users; never expose or commit the shared secret.

Select the microphone beside the message field to record a voice note, then select it again to stop and send. Notes are limited to 50 minutes and 20 MB. Calls and microphone recording require HTTPS and browser permission to use the microphone or camera.
