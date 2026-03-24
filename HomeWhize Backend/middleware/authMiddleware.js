import jwt from "jsonwebtoken";
import db from "../config/db.js";

/* AUTH PROTECTION */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, no token" });
    }

    const token = authHeader.split(" ")[1];
    
    // Verify token with issuer and audience checks
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "homewhize-backend",
      audience: "homewhize-frontend",
    });

    // Use async/await with db.execute for consistency with rest of codebase
    const [results] = await db.execute(
      "SELECT id, name, email, role FROM users WHERE id = ?",
      [decoded.id]
    );

    if (!results || results.length === 0) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = results[0];
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired, please login again" });
    }
    console.error('[AUTH] Authentication error:', error.message);
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
};

/* ROLE CHECK */
const roleMiddleware = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

export { protect, roleMiddleware };
