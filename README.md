# ResourceHub

A simple educational resource-sharing platform built with React and Supabase.

ResourceHub allows students to access and download study materials shared by authorized facilitators. Resources are organized by subject, making it easier for students to find useful PDFs and presentations.

## Features

- **User Authentication** — Sign up, log in, and verify your email.
- **Resource Uploads** — Authorized facilitators can upload PDF, PPT, and PPTX files.
- **Browse Resources** — View available study materials organized by subject.
- **Search and Filters** — Find resources by searching and filtering by file type.
- **Downloads** — Download study materials directly from the platform.
- **Like Resources** — Like or unlike resources to help identify useful materials.
- **Role-Based Access** — Students can access resources, while facilitators have upload permissions.

## Tech Stack

- **Frontend:** React.js, HTML, CSS, JavaScript
- **Backend and Database:** Supabase
- **Authentication:** Supabase Auth
- **File Storage:** Supabase Storage
- **Version Control:** Git and GitHub

## Getting Started

### Prerequisites

- Node.js and npm
- A Supabase account
- Git

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/YOUR-USERNAME/ResourceHub.git
   ```

2. Open the project folder:

   ```bash
   cd ResourceHub
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a `.env` file in the project root and add your Supabase project credentials:

   ```env
   REACT_APP_SUPABASE_URL=your_supabase_project_url
   REACT_APP_SUPABASE_KEY=your_supabase_publishable_key
   ```

5. Start the development server:

   ```bash
   npm start
   ```

The application should open at `http://localhost:3000`.

## Supabase Setup

ResourceHub uses Supabase for authentication, database operations, and file storage.

To run the application, configure your Supabase project with the required database tables, Row Level Security (RLS) policies, authentication settings, and a private storage bucket named `resources`.

Email verification and redirect URLs should be configured for your local development URL and deployed website.

## User Roles

| Role | Permissions |
|---|---|
| Student | Browse, download, and like resources |
| Facilitator | Browse, download, like, and upload resources |

New users are assigned the student role by default. Facilitator access must be granted through an authorized administrative process.

## Security

- Environment variables are kept out of version control.
- Supabase Row Level Security policies restrict database access.
- File access is controlled through Supabase Storage policies.
- Only authorized facilitators can upload resources.

## Project Status

ResourceHub is an ongoing student project focused on making educational resources easier to share and access.

## License

This project is currently intended for educational purposes. A formal open-source license can be added if the project is released under specific licensing terms.
