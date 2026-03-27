---
name: authentication-setup
description: Design and implement authentication and authorization systems. Use when setting up user login, JWT tokens, OAuth, session management, or role-based access control. Handles password security, token management, SSO integration.
metadata:
  tags: authentication, authorization, security, JWT, OAuth, RBAC
  platforms: Claude, ChatGPT, Gemini
---


# Authentication Setup


## When to use this skill

Lists specific situations where this skill should be triggered:

- **User Login System**: When adding user authentication to a new application
- **API Security**: When adding an authentication layer to a REST or GraphQL API
- **Permission Management**: When role-based access control is needed
- **Authentication Migration**: When migrating an existing auth system to JWT or OAuth
- **SSO Integration**: When integrating social login with Google, GitHub, Microsoft, etc.

## Input Format

The required and optional input information to collect from the user:

### Required Information
- **Authentication Method**: Choose from JWT, Session, or OAuth 2.0
- **Backend Framework**: Express, Django, FastAPI, Spring Boot, etc.
- **Database**: PostgreSQL, MySQL, MongoDB, etc.
- **Security Requirements**: Password policy, token expiry times, etc.

### Optional Information
- **MFA Support**: Whether to enable 2FA/MFA (default: false)
- **Social Login**: OAuth providers (Google, GitHub, etc.)
- **Session Storage**: Redis, in-memory, etc. (if using sessions)
- **Refresh Token**: Whether to use (default: true)

### Input Example

```
Build a user authentication system:
- Auth method: JWT
- Framework: Express.js + TypeScript
- Database: PostgreSQL
- MFA: Google Authenticator support
- Social login: Google, GitHub
- Refresh Token: enabled
```

## Instructions

Specifies the step-by-step task sequence to follow precisely.

### Step 1: Design the Data Model

Design the database schema for users and authentication.

**Tasks**:
- Design the User table (id, email, password_hash, role, created_at, updated_at)
- RefreshToken table (optional)
- OAuthProvider table (if using social login)
- Never store passwords in plaintext (bcrypt/argon2 hashing is mandatory)

**Example** (PostgreSQL):
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),  -- NULL if OAuth only
    role VARCHAR(50) DEFAULT 'user',
    is_verified BOOLEAN DEFAULT false,
    mfa_secret VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
```

### Step 2: Implement Password Security

Implement password hashing and verification logic.

**Tasks**:
- Use bcrypt (Node.js) or argon2 (Python)
- Set salt rounds to a minimum of 10
- Password strength validation (minimum 8 chars, upper/lowercase, numbers, special characters)

**Decision Criteria**:
- Node.js projects → use the bcrypt library
- Python projects → use argon2-cffi or passlib
- Performance-critical cases → choose bcrypt
- Cases requiring maximum security → choose argon2

**Example** (Node.js + TypeScript):
```typescript
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
    // Validate password strength
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecial) {
        throw new Error('Password must contain uppercase, lowercase, number, and special character');
    }

    return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
}
```

### Step 3: Generate and Verify JWT Tokens

Implement a token system for JWT-based authentication.

**Tasks**:
- Access Token (short expiry: 15 minutes)
- Refresh Token (long expiry: 7–30 days)
- Use a strong SECRET key for JWT signing (manage via environment variables)
- Include only the minimum necessary information in the token payload (user_id, role)

**Example** (Node.js):
```typescript
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

interface TokenPayload {
    userId: string;
    email: string;
    role: string;
}

export function generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
        issuer: 'your-app-name',
        audience: 'your-app-users'
    });
}

export function generateRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
        expiresIn: REFRESH_TOKEN_EXPIRY,
        issuer: 'your-app-name',
        audience: 'your-app-users'
    });
}

export function verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, ACCESS_TOKEN_SECRET, {
        issuer: 'your-app-name',
        audience: 'your-app-users'
    }) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
    return jwt.verify(token, REFRESH_TOKEN_SECRET, {
        issuer: 'your-app-name',
        audience: 'your-app-users'
    }) as TokenPayload;
}
```

### Step 4: Implement Authentication Middleware

Write authentication middleware to protect API requests.

**Checklist**:
- [x] Extract Bearer token from the Authorization header
- [x] Verify token and check expiry
- [x] Attach user info to req.user for valid tokens
- [x] Error handling (401 Unauthorized)

**Example** (Express.js):
```typescript
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt';

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
        role: string;
    };
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const payload = verifyAccessToken(token);
        req.user = payload;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
}

// Role-based authorization middleware
export function requireRole(...roles: string[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}
```

### Step 5: Implement Authentication API Endpoints

Write APIs for registration, login, token refresh, etc.

**Tasks**:
- POST /auth/register - registration
- POST /auth/login - login
- POST /auth/refresh - token refresh
- POST /auth/logout - logout
- GET /auth/me - current user info

**Example**:
```typescript
import express from 'express';
import { hashPassword, verifyPassword } from './password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from './jwt';
import { authenticateToken } from './middleware';

const router = express.Router();

// Registration
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check for duplicate email
        const existingUser = await db.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        // Hash the password
        const passwordHash = await hashPassword(password);

        // Create the user
        const user = await db.user.create({
            data: { email, password_hash: passwordHash, role: 'user' }
        });

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            role: user.role
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            role: user.role
        });

        // Store Refresh token in DB
        await db.refreshToken.create({
            data: {
                user_id: user.id,
                token: refreshToken,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
            }
        });

        res.status(201).json({
            user: { id: user.id, email: user.email, role: user.role },
            accessToken,
            refreshToken
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find the user
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify the password
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            role: user.role
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            role: user.role
        });

        // Store Refresh token
        await db.refreshToken.create({
            data: {
                user_id: user.id,
                token: refreshToken,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            }
        });

        res.json({
            user: { id: user.id, email: user.email, role: user.role },
            accessToken,
            refreshToken
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Token refresh
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        // Verify Refresh token
        const payload = verifyRefreshToken(refreshToken);

        // Check token in DB
        const storedToken = await db.refreshToken.findUnique({
            where: { token: refreshToken }
        });

        if (!storedToken || storedToken.expires_at < new Date()) {
            return res.status(403).json({ error: 'Invalid or expired refresh token' });
        }

        // Generate new Access token
        const accessToken = generateAccessToken({
            userId: payload.userId,
            email: payload.email,
            role: payload.role
        });

        res.json({ accessToken });
    } catch (error) {
        res.status(403).json({ error: 'Invalid refresh token' });
    }
});

// Current user info
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const user = await db.user.findUnique({
            where: { id: req.user!.userId },
            select: { id: true, email: true, role: true, created_at: true }
        });

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
```

## Output format

Defines the exact format that deliverables should follow.

### Basic Structure

```
Project directory/
├── src/
│   ├── auth/
│   │   ├── password.ts          # password hashing/verification
│   │   ├── jwt.ts                # JWT token generation/verification
│   │   ├── middleware.ts         # authentication middleware
│   │   └── routes.ts             # authentication API endpoints
│   ├── models/
│   │   └── User.ts               # user model
│   └── database/
│       └── schema.sql            # database schema
├── .env.example                  # environment variable template
└── README.md                     # authentication system documentation
```

### Environment Variable File (.env.example)

```bash
# JWT Secrets (MUST change in production)
ACCESS_TOKEN_SECRET=your-access-token-secret-min-32-characters
REFRESH_TOKEN_SECRET=your-refresh-token-secret-min-32-characters

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/myapp

# OAuth (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

## Constraints

Specifies mandatory rules and prohibited actions.

### Mandatory Rules (MUST)

1. **Password Security**: Never store passwords in plaintext
   - Use a proven hashing algorithm such as bcrypt or argon2
   - Salt rounds minimum of 10

2. **Environment Variable Management**: Manage all secret keys via environment variables
   - Add .env files to .gitignore
   - Provide a list of required variables via .env.example

3. **Token Expiry**: Access Tokens should be short-lived (15 min), Refresh Tokens appropriately longer (7 days)
   - Balance security and user experience
   - Store Refresh Tokens in the DB to enable revocation

### Prohibited Actions (MUST NOT)

1. **Plaintext Passwords**: Never store passwords in plaintext or print them to logs
   - Serious security risk
   - Legal liability issues

2. **Hardcoding JWT SECRET**: Do not write SECRET keys directly in code
   - Risk of being exposed on GitHub
   - Production security vulnerability

3. **Sensitive Data in Tokens**: Do not include passwords, card numbers, or other sensitive data in JWT payloads
   - JWT can be decoded (it is not encrypted)
   - Include only the minimum information (user_id, role)

### Security Rules

- **Rate Limiting**: Apply rate limiting to the login API (prevents brute-force attacks)
- **HTTPS Required**: Use HTTPS only in production environments
- **CORS Configuration**: Allow only approved domains to access the API
- **Input Validation**: Validate all user input (prevents SQL Injection and XSS)

## Examples

Demonstrates how to apply the skill through real-world use cases.

### Example 1: Express.js + PostgreSQL JWT Authentication

**Situation**: Adding JWT-based user authentication to a Node.js Express app

**User Request**:
```
Add JWT authentication to an Express.js app using PostgreSQL,
with access token expiry of 15 minutes and refresh token expiry of 7 days.
```

**Skill Application Process**:

1. Install packages:
   ```bash
   npm install jsonwebtoken bcrypt pg
   npm install --save-dev @types/jsonwebtoken @types/bcrypt
   ```

2. Create the database schema (use the SQL above)

3. Set environment variables:
   ```bash
   ACCESS_TOKEN_SECRET=$(openssl rand -base64 32)
   REFRESH_TOKEN_SECRET=$(openssl rand -base64 32)
   ```

4. Implement auth modules (use the code examples above)

5. Connect API routes:
   ```typescript
   import authRoutes from './auth/routes';
   app.use('/api/auth', authRoutes);
   ```

**Final Result**: JWT-based authentication system complete, registration/login/token-refresh APIs working

### Example 2: Role-Based Access Control (RBAC)

**Situation**: A permission system that distinguishes administrators from regular users

**User Request**:
```
Create an API accessible only to administrators.
Regular users should receive a 403 error.
```

**Final Result**:
```typescript
// Admin-only API
router.delete('/users/:id',
    authenticateToken,           // verify authentication
    requireRole('admin'),         // verify role
    async (req, res) => {
        // user deletion logic
        await db.user.delete({ where: { id: req.params.id } });
        res.json({ message: 'User deleted' });
    }
);

// Usage example
// Regular user (role: 'user') request → 403 Forbidden
// Admin (role: 'admin') request → 200 OK
```

## Best practices

Recommendations for using this skill effectively.

### Quality Improvement

1. **Password Rotation Policy**: Recommend periodic password changes
   - Change notification every 90 days
   - Prevent reuse of the last 5 passwords
   - Balance user experience and security

2. **Multi-Factor Authentication (MFA)**: Apply 2FA to important accounts
   - Use TOTP apps such as Google Authenticator or Authy
   - SMS is less secure (risk of SIM swapping)
   - Provide backup codes

3. **Audit Logging**: Log all authentication events
   - Record login success/failure, IP address, and User Agent
   - Anomaly detection and post-incident analysis
   - GDPR compliance (exclude sensitive data)

### Efficiency Improvements

- **Token Blacklist**: Revoke Refresh Tokens on logout
- **Redis Caching**: Cache frequently used user data
- **Database Indexing**: Add indexes on email and refresh_token

## Common Issues

Common problems and their solutions.

### Issue 1: "JsonWebTokenError: invalid signature"

**Symptom**:
- Error occurs during token verification
- Login succeeds but authenticated API calls fail

**Cause**:
The SECRET keys for Access Token and Refresh Token are different,
but the same key is being used to verify both.

**Solution**:
1. Check environment variables: `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`
2. Use the correct SECRET for each token type
3. Verify that environment variables load correctly (initialize `dotenv`)

### Issue 2: Frontend Cannot Log In Due to CORS Error

**Symptom**: "CORS policy" error in the browser console

**Cause**: Missing CORS configuration on the Express server

**Solution**:
```typescript
import cors from 'cors';

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
```

### Issue 3: Refresh Token Keeps Expiring

**Symptom**: Users are frequently logged out

**Cause**: Refresh Token is not properly managed in the DB

**Solution**:
1. Confirm Refresh Token is saved to DB upon creation
2. Set an appropriate expiry time (minimum 7 days)
3. Add a cron job to regularly clean up expired tokens

## References

### Official Documentation
- [JWT.io - JSON Web Token Introduction](https://jwt.io/introduction)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)

### Libraries
- [jsonwebtoken (Node.js)](https://github.com/auth0/node-jsonwebtoken)
- [bcrypt (Node.js)](https://github.com/kelektiv/node.bcrypt.js)
- [Passport.js](http://www.passportjs.org/) - multiple authentication strategies
- [NextAuth.js](https://next-auth.js.org/) - Next.js authentication

### Security Guides
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)

## Metadata

### Version
- **Current Version**: 1.0.0
- **Last Updated**: 2025-01-01
- **Compatible Platforms**: Claude, ChatGPT, Gemini

### Related Skills
- [api-design](../api-design/SKILL.md): API endpoint design
- [security](../../infrastructure/security/SKILL.md): Security best practices

### Tags
`#authentication` `#authorization` `#JWT` `#OAuth` `#security` `#backend`
