# Rust Exercises Local Lab

This is a local companion app for the 100 Exercises to Learn Rust repository.
It reads the course structure from `book/src/SUMMARY.md`, loads each exercise's
starter source, and runs submissions with the local Rust toolchain.

## Run it

From this directory:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite frontend proxies
exercise runs to the local runner on port `3001`.

For a production-style local run:

```bash
npm run build
npm start
```

Then open [http://localhost:3001](http://localhost:3001).

Submissions are compiled and tested in temporary copies of the exercise. The
editor contents and exercise statuses are stored in browser `localStorage`, so
they persist across tabs and browser restarts.
