require("dotenv").config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const app = express();
const port = process.env.PORT || 3000;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "blog_avatars",
    allowed_formats: ["jpg", "png", "jpeg"]
  }
});

const upload = multer({ storage: storage });

//Database
const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URL)
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.log(err));

//post schema
const postSchema = new mongoose.Schema({
  title: String,
  content: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  likes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ]
}, { timestamps: true });
const Post = mongoose.model("Post", postSchema);

//user schema
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  displayName: {
    type: String,
    default: ""
  },

  profilePic: {
    type: String,
    default: "/default-avatar.png"
  }
});
const User = mongoose.model("User", userSchema);

//Middleware
app.use(express.urlencoded( {extended: true }));
app.use(express.static("public"));

const session = require("express-session");
const MongoStore = require("connect-mongo").default;

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new MongoStore({
    mongoUrl: process.env.MONGO_URL
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

function isLoggedIn(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).send("Please login first");
  }
  next();
}

//Set EJS
app.set("view engine", "ejs");

//Temporary in-memory storage
//let posts = [];

//Home route - show all posts
app.get("/", async (req, res) => {
  const posts = await Post.find()
    .populate("user")
    .sort({ createdAt: -1 });

  const currentUser = req.session.userId || null;

  res.render("index", { 
  posts,
  currentUser: req.session.userId || null
});
});

//Show form to create new posts
app.get("/new", isLoggedIn, (req,res) => {
    res.render("new");
});

//Create new post
app.post("/posts", isLoggedIn, async (req, res) => {
  const { title, content } = req.body;

  await Post.create({
    title,
    content,
    user: req.session.userId
  });

  res.redirect("/");
});

// Show edit form
app.get("/edit/:id", isLoggedIn, async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post.user.equals(req.session.userId)) {
    return res.send("Not authorized");
  }

  res.render("edit", { post });
});

// Update post
app.post("/edit/:id", isLoggedIn, async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post.user.equals(req.session.userId)) {
    return res.send("Not authorized");
  }

  await Post.findByIdAndUpdate(req.params.id, {
    title: req.body.title,
    content: req.body.content
  });

  res.redirect("/");
});

// Delete post
app.post("/delete/:id", isLoggedIn, async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post.user.equals(req.session.userId)) {
    return res.send("Not authorized");
  }

  await Post.findByIdAndDelete(req.params.id);

  res.redirect("/");
});

// Show register page
app.get("/register", (req, res) => {
  res.render("register");
});

// Handle registration
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const newUser = await User.create({
  username,
  password: hashedPassword,
  displayName: username   // 👈 ADD THIS
});

    req.session.userId = newUser._id;
    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.send("Username already exists");
  }
});

// Show login page
app.get("/login", (req, res) => {
  res.render("login");
});

// Handle login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });

  if (!user) {
    return res.send("User not found");
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.send("Incorrect password");
  }

  req.session.userId = user._id;
  res.redirect("/");
});

//Log-out
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

//Profile Route
// ===== MY PROFILE PAGE =====
app.get("/profile", isLoggedIn, async (req, res) => {

  const user = await User.findById(req.session.userId);

  const posts = await Post.find({ user: user._id })
    .sort({ createdAt: -1 });

  res.render("profile", {
    user,
    posts,
    currentUser: req.session.userId || null
  });

});

//toggle route
app.post("/like/:postId", isLoggedIn, async (req, res) => {
  const post = await Post.findById(req.params.postId);

  const userId = req.session.userId;

  const alreadyLiked = post.likes.includes(userId);

  if (alreadyLiked) {
    post.likes.pull(userId); // unlike
  } else {
    post.likes.push(userId); // like
  }

  await post.save();

  res.redirect("/");
});

// Edit Profile page
app.get("/edit-profile", isLoggedIn, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render("editProfile", { user });
});


// My Posts page
app.get("/my-posts", isLoggedIn, async (req, res) => {
    const posts = await Post.find({ user: req.session.userId });
    res.render("myPosts", { posts });
});

//update routes
app.post("/update-profile", isLoggedIn, async (req, res) => {

  const { displayName, username } = req.body;

  const existingUser = await User.findOne({ username });

  if (existingUser && existingUser._id.toString() !== req.session.userId) {
    return res.send("Username already taken");
  }

  await User.findByIdAndUpdate(req.session.userId, {
    displayName,
    username
  });

  res.redirect("/profile");

});

app.post("/update-avatar", isLoggedIn, upload.single("avatar"), async (req, res) => {

  if (!req.file) return res.redirect("/profile");

  await User.findByIdAndUpdate(req.session.userId, {
    profilePic: req.file.path
  });

  res.redirect("/profile");

});

// ===== VIEW OTHER USER PROFILE =====
app.get("/profile/:username", isLoggedIn, async (req, res) => {

  const user = await User.findOne({ username: req.params.username });

  if (!user) return res.send("User not found");

  const posts = await Post.find({ user: user._id })
    .sort({ createdAt: -1 });

  res.render("profile", {
    user,
    posts,
    currentUser: req.session.userId
  });

});

//end
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);

});

