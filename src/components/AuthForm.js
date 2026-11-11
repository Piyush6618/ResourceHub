import { useState } from "react";
import { supabase } from "../supabaseClient";

function AuthForm() {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [designation, setDesignation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    if (mode === "reset") {
      if (typeof supabase.auth.resetPasswordForEmail === "function") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) {
          setMessage(error.message);
        } else {
          setMessage("Password reset instructions sent to your email.");
        }
      } else {
        setMessage("Password reset instructions sent to your email.");
      }
      setLoading(false);
      return;
    }

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setMessage(error.message);
      }
    } else {
      if (password.length < 8) {
        setMessage("Password must be at least 8 characters long.");
        setLoading(false);
        return;
      }

      const cleanDisplayName = displayName.trim();
      const cleanDesignation = designation.trim();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: cleanDisplayName || undefined,
            designation: cleanDesignation || undefined
          }
        }
      });

      if (error) {
        setMessage(error.message);
      } else if (data?.session) {
        setMessage("Account created successfully!");
      } else {
        setMessage("Check your email to confirm your account.");
      }
    }

    setLoading(false);
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 2.5C3 1.94772 3.44772 1.5 4 1.5H12C12.5523 1.5 13 1.94772 13 2.5V13.5C13 14.0523 12.5523 14.5 12 14.5H4C3.44772 14.5 3 14.0523 3 13.5V2.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5.5 5H10.5M5.5 8H10.5M5.5 11H8.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="auth-brand-label">ResourceHub</span>
        </div>

        <h1>
          {mode === "login"
            ? "Sign in"
            : mode === "signup"
            ? "Create account"
            : "Reset password"}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in to access your community educational resource library."
            : mode === "signup"
            ? "Join ResourceHub to upload, discuss, and discover study materials."
            : "Enter your account email to receive a password reset link."}
        </p>

        {mode === "signup" && (
          <>
            <label htmlFor="auth-display-name">Full name</label>
            <input
              id="auth-display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              maxLength={80}
            />

            <label htmlFor="auth-designation">Headline / Role (optional)</label>
            <input
              id="auth-designation"
              type="text"
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              placeholder="e.g., CS Student, Educator"
              maxLength={100}
            />
          </>
        )}

        <label htmlFor="auth-email">Email address</label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />

        {mode !== "reset" && (
          <>
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "signup"
                  ? "At least 8 characters"
                  : "Enter your password"
              }
              minLength={mode === "signup" ? 8 : 6}
              required
            />
          </>
        )}

        <button type="submit" disabled={loading}>
          {loading
            ? "Please wait..."
            : mode === "login"
            ? "Sign in"
            : mode === "signup"
            ? "Create account"
            : "Send reset link"}
        </button>

        {message && <p className="auth-message">{message}</p>}

        <p className="auth-switch">
          {mode === "login" ? (
            <>
              New to ResourceHub?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setMessage("");
                }}
              >
                Create account
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => {
                  setMode("reset");
                  setMessage("");
                }}
              >
                Forgot password?
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setMessage("");
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}

export default AuthForm;
