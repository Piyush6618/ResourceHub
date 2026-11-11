import { useState } from "react";
import { supabase } from "../supabaseClient";

function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setMessage(error.message);
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        setMessage(error.message);
      } else if (data.session) {
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

        <h1>{isLogin ? "Sign in" : "Create account"}</h1>
        <p>
          {isLogin
            ? "Sign in to access your educational resource library."
            : "Create an account to browse and manage study materials."}
        </p>

        <label htmlFor="auth-email">Email address</label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />

        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 6 characters"
          minLength={6}
          required
        />

        <button type="submit" disabled={loading}>
          {loading
            ? "Please wait..."
            : isLogin
            ? "Sign in"
            : "Create account"}
        </button>

        {message && <p className="auth-message">{message}</p>}

        <p className="auth-switch">
          {isLogin ? "New to ResourceHub?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setMessage("");
            }}
          >
            {isLogin ? "Create account" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}

export default AuthForm;
