import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import cache from "../config/cache.js";

const COMMUNITY_POSTS_CACHE_KEY = 'community:posts';
const COMMUNITY_POSTS_TTL_MS = parseInt(process.env.COMMUNITY_POSTS_TTL_MS || '15000', 10);

const clearCommunityPostsCache = async () => {
  try {
    await cache.del(COMMUNITY_POSTS_CACHE_KEY);
  } catch (err) {
    console.warn('Failed to clear community posts cache:', err && err.message ? err.message : err);
  }
};

/* ===================== CREATE POST ===================== */
export const createPost = async (req, res) => {
  const { content } = req.body;
  const { id, name } = req.user;

  const postSql =
    "INSERT INTO community_posts (user_id, user_name, content) VALUES (?, ?, ?)";

  db.query(postSql, [id, name, content], async (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Failed to create post" });
    }

    const postId = result.insertId;

    if (req.files?.length) {
      try {
        for (const file of req.files) {
          const upload = await new Promise((resolve, reject) => {
            cloudinary.uploader
              .upload_stream({ folder: "community" }, (e, r) =>
                e ? reject(e) : resolve(r)
              )
              .end(file.buffer);
          });

          db.query(
            "INSERT INTO community_post_images (post_id, image_url) VALUES (?, ?)",
            [postId, upload.secure_url]
          );
        }
      } catch (uploadErr) {
        console.error(uploadErr);
      }
    }

    await clearCommunityPostsCache();
    res.json({ message: "Post created" });
  });
};

/* ===================== GET POSTS ===================== */
export const getPosts = async (req, res) => {
  try {
    const cached = await cache.get(COMMUNITY_POSTS_CACHE_KEY);
    if (cached) {
      return res.json(cached);
    }
  } catch (cacheErr) {
    console.warn('Community posts cache lookup failed:', cacheErr && cacheErr.message ? cacheErr.message : cacheErr);
  }

  const sql = `
    SELECT p.*,
    COUNT(l.id) AS likes
    FROM community_posts p
    LEFT JOIN community_likes l ON p.id = l.post_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;

  db.query(sql, async (err, posts) => {
    if (err) {
      console.error(err);
      return res.status(500).json([]);
    }

    if (!posts || !posts.length) return res.json([]);

    const postIds = posts.map(p => p.id);

    if (postIds.length === 0) {
      return res.json(posts);
    }

    const placeholders = postIds.map(() => '?').join(',');
    db.query(
      `SELECT * FROM community_post_images WHERE post_id IN (${placeholders})`,
      postIds,
      async (err2, imgs) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json([]);
        }

        posts.forEach(p => {
          p.images = imgs
            ?.filter(i => i.post_id === p.id)
            .map(i => i.image_url) || [];

          p.comments = [];
          p.liked = false;
          p.likes = Number(p.likes) || 0;
        });

        try {
          await cache.set(COMMUNITY_POSTS_CACHE_KEY, posts, COMMUNITY_POSTS_TTL_MS);
        } catch (cacheErr) {
          console.warn('Failed to cache community posts:', cacheErr && cacheErr.message ? cacheErr.message : cacheErr);
        }

        res.json(posts);
      }
    );
  });
};

/* ===================== DELETE POST ===================== */
export const deletePost = async (req, res) => {
  const { postId } = req.params;
  const { id, role } = req.user;

  try {
    const [rows] = await db.execute(
      "SELECT user_id FROM community_posts WHERE id = ? LIMIT 1",
      [postId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isOwner = Number(rows[0].user_id) === Number(id);
    const isSuperAdmin = String(role || "").toLowerCase() === "superadmin";

    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ message: "Only superadmins can delete other users' posts" });
    }

    await db.execute("DELETE FROM community_posts WHERE id = ?", [postId]);
    await clearCommunityPostsCache();
    return res.json({ message: "Post deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to delete post" });
  }
};

/* ===================== COMMENTS ===================== */
export const addComment = (req, res) => {
  const { postId } = req.params;
  const { comment } = req.body;
  const { name } = req.user;

  db.query(
    "INSERT INTO community_comments (post_id, user_name, comment) VALUES (?, ?, ?)",
    [postId, name, comment],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to add comment" });
      }
      res.json({ message: "Comment added" });
    }
  );
};

export const getComments = (req, res) => {
  db.query(
    "SELECT * FROM community_comments WHERE post_id=? ORDER BY created_at DESC LIMIT 3",
    [req.params.postId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json([]);
      }
      res.json(rows || []);
    }
  );
};

/* ===================== LIKES ===================== */
export const toggleLike = (req, res) => {
  const { postId } = req.params;
  const { id } = req.user;

  db.query(
    "SELECT * FROM community_likes WHERE post_id=? AND user_id=?",
    [postId, id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Like check failed" });
      }

      if (rows && rows.length > 0) {
        db.query(
          "DELETE FROM community_likes WHERE post_id=? AND user_id=?",
          [postId, id],
          async (delErr) => {
            if (delErr) {
              console.error(delErr);
              return res.status(500).json({ message: "Failed to unlike" });
            }
            await clearCommunityPostsCache();
            res.json({ liked: false });
          }
        );
      } else {
        db.query(
          "INSERT INTO community_likes (post_id, user_id) VALUES (?, ?)",
          [postId, id],
          async (insErr) => {
            if (insErr) {
              console.error(insErr);
              return res.status(500).json({ message: "Failed to like" });
            }
            await clearCommunityPostsCache();
            res.json({ liked: true });
          }
        );
      }
    }
  );
};
