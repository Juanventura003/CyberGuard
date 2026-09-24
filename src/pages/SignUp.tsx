import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await signUp(email, password)

    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess(true)
  }

  if (success) {
    return (
      <div className="signup-page">
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to <strong>{email}</strong>. Confirm
          your account, then{' '}
          <Link to="/login">sign in</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="signup-page">
      <form onSubmit={handleSubmit}>
        <h1>Create Account</h1>

        {error && <p className="error">{error}</p>}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Sign Up'}
        </button>

        <p>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  )
}