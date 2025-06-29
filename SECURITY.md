# CYPH3R C0D3 Security Guide

## 🔒 Authentication & Security Features

This application includes a robust authentication system to protect your code editor when deployed on a public server.

## 🚀 Quick Setup

1. **Copy the environment configuration:**
   ```bash
   cp config.env.example .env
   ```

2. **Edit `.env` file and change the default credentials:**
   ```env
   ADMIN_USERNAME=your_username
   ADMIN_PASSWORD=your_secure_password
   SESSION_SECRET=generate-a-random-string-here
   ```

3. **Restart the server:**
   ```bash
   npm start
   ```

## 🛡️ Security Features

### 1. **User Authentication**
- Username/password based authentication
- Passwords are hashed using bcrypt
- Session-based authentication with secure cookies
- Automatic logout on session expiry (24 hours)

### 2. **Rate Limiting**
- Protection against brute force attacks
- Max 10 login attempts per 15 minutes per IP
- Temporary IP ban after 5 failed attempts (15 minutes)

### 3. **IP Whitelisting (Optional)**
- Restrict access to specific IP addresses
- Configure in `.env` file:
  ```env
  IP_WHITELIST=192.168.1.100,10.0.0.1
  ```

### 4. **Security Headers**
- Helmet.js for secure HTTP headers
- XSS Protection
- Clickjacking Protection
- MIME Type Sniffing Protection

### 5. **Session Security**
- HTTPOnly cookies (prevents XSS attacks)
- Secure session storage
- Session regeneration on login

## 📝 Configuration Options

All security settings can be configured in the `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_ENABLED` | Enable/disable authentication | `true` |
| `ADMIN_USERNAME` | Admin username | `admin` |
| `ADMIN_PASSWORD` | Admin password (will be hashed) | `changeme123` |
| `SESSION_SECRET` | Secret key for session encryption | (random) |
| `IP_WHITELIST` | Comma-separated list of allowed IPs | (empty = allow all) |
| `MAX_LOGIN_ATTEMPTS` | Max failed attempts before ban | `5` |
| `BAN_DURATION` | Ban duration in minutes | `15` |

## 🔐 Best Practices

### For Production Deployment:

1. **Change Default Credentials Immediately**
   ```bash
   # Generate a strong password
   openssl rand -base64 32
   ```

2. **Generate a Secure Session Secret**
   ```bash
   # Generate a secure session secret
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

3. **Enable HTTPS**
   - Use a reverse proxy (nginx/Apache) with SSL certificates
   - Set `cookie.secure = true` in session configuration

4. **Use IP Whitelisting**
   - If you're the only user, whitelist your IP address
   - For dynamic IPs, consider using a VPN

5. **Monitor Access Logs**
   - Check server logs regularly for unauthorized access attempts
   - Monitor failed login attempts

## 🚨 Security Warnings

⚠️ **NEVER use default credentials in production!**

⚠️ **NEVER commit `.env` file to version control!**

⚠️ **ALWAYS use HTTPS in production environments!**

⚠️ **Keep the application and dependencies updated!**

## 🔧 Disabling Authentication

If you want to disable authentication (NOT recommended for public servers):

```env
AUTH_ENABLED=false
```

## 🆘 Troubleshooting

### Forgot Password
Since this is a single-user system, you'll need to:
1. Stop the server
2. Update the password in `.env`
3. Restart the server

### Locked Out Due to IP Ban
1. Wait 15 minutes for the ban to expire
2. Or restart the server to clear all bans
3. Or whitelist your IP in `.env`

### Session Issues
- Clear browser cookies
- Try incognito/private browsing mode
- Check that session secret hasn't changed

## 🔍 Security Audit Checklist

- [ ] Changed default username and password
- [ ] Generated secure session secret
- [ ] Enabled HTTPS (for production)
- [ ] Configured IP whitelist (if needed)
- [ ] Tested authentication works correctly
- [ ] Verified rate limiting is active
- [ ] Checked no sensitive data in logs
- [ ] Ensured `.env` is in `.gitignore`

## 📊 Security Headers Test

After deployment, test your security headers at:
- https://securityheaders.com
- https://observatory.mozilla.org

## 🐛 Reporting Security Issues

If you discover a security vulnerability, please:
1. Do NOT open a public issue
2. Email details to: [your-email@example.com]
3. Include steps to reproduce
4. Allow time for a patch before disclosure

---

Stay secure! 🔐 