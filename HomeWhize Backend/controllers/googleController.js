import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail } from "../models/userModel.js";
import { sendSignupEmail } from "../utils/emailService.js";

dotenv.config();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleAuth = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token)
      return res.status(400).json({ message: "Google token missing" });

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name } = ticket.getPayload();

    findUserByEmail(email, async (err, users) => {
      if (err)
        return res.status(500).json({ message: "Database error" });

      let user;
      let isNewUser = false;

      // 🟢 IF USER DOES NOT EXIST → CREATE
      if (users.length === 0) {
        isNewUser = true;
        const randomPassword = await bcrypt.hash(
          Math.random().toString(36),
          10
        );

        createUser(
          name,
          email,
          randomPassword,
          "user",
          "google",
          (err, result) => {
            if (err)
              return res
                .status(500)
                .json({ message: "Failed to create Google user" });

            user = {
              id: result.insertId,
              name,
              email,
              role: "user",
            };

            // Send signup acknowledgment email for new Google users
            sendSignupEmail(user, "google")
              .then(() => {
                console.log("Google signup email sent to", email);
              })
              .catch((emailErr) => {
                console.warn("Failed to send Google signup email:", emailErr);
                // Don't fail the login if email fails
              });

            issueToken(res, user);
          }
        );
      } else {
        user = users[0];
        issueToken(res, user);
      }
    });
  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(401).json({ message: "Invalid Google token" });
  }
};

const issueToken = (res, user) => {
  const jwtToken = jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "2h",                   // Reduced for better security
      issuer: "homewhize-backend",
      audience: "homewhize-frontend",
    }
  );

  res.status(200).json({
    message: "Login successful",
    token: jwtToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
};
