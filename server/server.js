const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const sendEmail = require('./emailService');
const crypto = require('crypto');

const pool = new Pool({
  user: 'postgres',
  host: '192.168.1.6',
  database: 'php_training',
  password: 'mawai123',
  port: 5432,
});

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000 },
  fileFilter: (req, file, cb) => {
    checkFileType(file, cb);
  },
}).single('image');

function checkFileType(file, cb) {
  const filetypes = /jpeg|jpg|png|gif/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb('Error: Images Only!');
  }
}

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Generate OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Signup route
app.post('/signup', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).send({ message: err });
    }
    const { username, password, email, fullName } = req.body;
    const imagePath = req.file ? req.file.path : null;

    try {
      const existingUser = await pool.query('SELECT * FROM anirudh.users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).send({ message: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await pool.query(
        'INSERT INTO anirudh.users (username, password, email, full_name, image) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [username, hashedPassword, email, fullName, imagePath]
      );

      sendEmail(
        email,
        'Registration Successful',
        `Hello ${fullName},\n\nYou have successfully registered with the username: ${username}.`
      );

      console.log('Registration email sent to:', email);
      res.json(newUser.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  });
});

// Login route
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await pool.query('SELECT * FROM anirudh.users WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const isValidPassword = await bcrypt.compare(password, user.rows[0].password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const token = jwt.sign({ userId: user.rows[0].id }, 'your_secret_key');
    res.json({ 
      token, 
      userImage: user.rows[0].image
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Get user details route
app.get('/user-details', async (req, res) => {
  try {
    const token = req.headers['authorization'].split(' ')[1];
    const decoded = jwt.verify(token, 'your_secret_key');
    const userId = decoded.userId;

    const user = await pool.query('SELECT username, email, full_name, image FROM anirudh.users WHERE id = $1', [userId]);

    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Update profile route
app.post('/update-profile', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('File upload error:', err);
      return res.status(400).send({ message: err });
    }

    try {
      const token = req.headers['authorization'].split(' ')[1];
      const decoded = jwt.verify(token, 'your_secret_key');
      const userId = decoded.userId;

      const { username, email, fullName } = req.body;
      let imagePath = req.file ? req.file.path : null;

      // If no new image is provided, fetch the current image path from the database
      if (!imagePath) {
        const user = await pool.query('SELECT image FROM anirudh.users WHERE id = $1', [userId]);
        if (user.rows.length === 0) {
          return res.status(404).json({ message: 'User not found' });
        }
        imagePath = user.rows[0].image;
      }

      const updateQuery = `
        UPDATE anirudh.users 
        SET username = $1, email = $2, full_name = $3, image = $4
        WHERE id = $5 
        RETURNING *`;
      const queryParams = [username, email, fullName, imagePath, userId];

      const updatedUser = await pool.query(updateQuery, queryParams);

      sendEmail(
        email,
        'Profile Updated',
        `Hello ${fullName},\n\nYour profile has been updated successfully. Here are your new details:\n\nUsername: ${username}\nEmail: ${email}\nFull Name: ${fullName}`
      );

      console.log('Profile update email sent to:', email);
      res.json(updatedUser.rows[0]);
    } catch (err) {
      console.error('Database update error:', err.message);
      res.status(500).send('Server error');
    }
  });
});

// Forgot password route
// Forgot password route
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await pool.query('SELECT * FROM anirudh.users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      return res.status(400).json({ message: 'Email not found' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60000); // OTP expires in 15 minutes

    await pool.query(
      'UPDATE anirudh.users SET otp = $1, otp_expires_at = $2 WHERE email = $3',
      [otp, expiresAt, email]
    );
    console.log(otp, expiresAt, email);

    sendEmail(
      email,
      'Password Reset OTP',
      `Your OTP for password reset is ${otp}. It will expire in 15 minutes.`
    );

    res.status(200).json({ message: 'OTP sent to your email', otp }); // Return the OTP to the client
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});


// Verify OTP route
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const user = await pool.query(
      'SELECT * FROM anirudh.users WHERE email = $1 AND otp = $2 AND otp_expires_at > NOW()',
      [email, otp]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // await pool.query('UPDATE anirudh.users SET otp = NULL, otp_expires_at = NULL WHERE email = $1', [email]);

    const token = jwt.sign({ userId: user.rows[0].id }, 'your_secret_key');

    res.status(200).json({ message: 'OTP verified', token });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Reset password route
app.post('/reset-password', async (req, res) => {
  const { otp, newPassword } = req.body;
  const otp_val = otp;
  console.log(otp_val); // Check if the OTP value is logged correctly

  try {
    // Fetch the user based on the provided OTP
    const user = await pool.query('SELECT * FROM anirudh.users WHERE otp = $1', [otp_val]);
    console.log(user.rows); // Log the user data to check if it's fetched correctly

    if (user.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    await pool.query('UPDATE anirudh.users SET password = $1 WHERE otp = $2', [hashedPassword, otp_val]);

    // Clear OTP and expiry in the database
    await pool.query('UPDATE anirudh.users SET otp = NULL, otp_expires_at = NULL WHERE otp = $1', [otp_val]);

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});




app.get('/', (req, res) => {
  console.log('Home page');
  res.send('Home page');
});

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
