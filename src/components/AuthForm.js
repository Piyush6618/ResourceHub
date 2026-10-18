
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
        <h1>ResourceHub</h1>
        <p>
          {isLogin
            ? "Sign in to your student account"
            : "Create your student account"}
        </p>

        <label>Email address</label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />

        <label>Password</label>
        <input
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
          {isLogin ? "New to ResourceHub?" : "Already have an account?"}
          {" "}
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
