"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Github, Lock, User } from "lucide-react";
import { useRouter } from "next/navigation";

export const dynamic = "force-dynamic";

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid = useMemo(
    () => username.trim().length > 0 && password.trim().length > 0,
    [username, password],
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!isValid) {
      setError("Enter your username and password.");
      return;
    }

    setLoading(true);
    setTimeout(() => {
      if (username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD) {
        if (remember) {
          window.localStorage.setItem("backtrack-auth", "admin");
        }
        router.push("/");
      } else {
        setError("Invalid credentials. Use admin / admin.");
      }
      setLoading(false);
    }, 500);
  };

  return (
    <div className="min-h-screen w-full bg-[#161C27] flex flex-col items-center justify-center px-6 py-10">
      <div className="flex flex-col items-center mb-8">
        <h1 className="text-white text-3xl font-semibold">BackTrack</h1>
        <p className="text-gray-400 text-sm mt-2">Sign in to your account</p>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-[#2B3851] bg-[#1B2943]/80 p-8 shadow-xl">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs text-gray-300">Name</label>
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-[#3A4B6B] bg-[#223454] px-4 py-3">
              <User size={16} className="text-gray-400" />
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin"
                className="w-full bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-300">Password</label>
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-[#3A4B6B] bg-[#223454] px-4 py-3">
              <Lock size={16} className="text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="admin"
                className="w-full bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="text-gray-400 hover:text-gray-200"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-400">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-3 w-3 rounded border-gray-500 bg-transparent text-blue-500"
              />
              Remember me
            </label>
            <button type="button" className="text-blue-400 hover:text-blue-300">
              Forgot Password
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#1D62C6] py-3 text-sm font-semibold text-white transition hover:bg-[#1A57AD] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="flex items-center gap-3 text-xs text-gray-500">
            <div className="h-px flex-1 bg-[#2E3C57]" />
            Or login with
            <div className="h-px flex-1 bg-[#2E3C57]" />
          </div>

          <div className="space-y-3">
            <button
              type="button"
              className="w-full rounded-xl border border-[#2F3F5A] bg-[#0F1725] py-2 text-xs text-gray-200 hover:bg-[#152032]"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 48 48"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
                    fill="#FFC107"
                  />
                  <path
                    d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
                    fill="#FF3D00"
                  />
                  <path
                    d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
                    fill="#4CAF50"
                  />
                  <path
                    d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
                    fill="#1976D2"
                  />
                </svg>
                Google
              </span>
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-[#2F3F5A] bg-[#0F1725] py-2 text-xs text-gray-200 hover:bg-[#152032]"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 98 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
                    fill="#fff"
                  />
                </svg>
                Github
              </span>
            </button>
          </div>

          <div className="text-center text-xs text-gray-400">
            Don&apos;t have an account?
            <button
              type="button"
              className="ml-1 text-blue-400 hover:text-blue-300"
            >
              Sign Up
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
