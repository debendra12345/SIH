const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    role: {
      type: String,
      enum: {
        values: ['doctor', 'patient', 'admin'],
        message: '{VALUE} is not a supported role',
      },
      default: 'patient',
      required: [true, 'Please specify user role'],
    },
    doctorId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    mobileNumber: {
      type: String,
      trim: true,
      sparse: true,
    },
    age: {
      type: Number,
      min: [0, 'Age must be positive'],
      max: [130, 'Age must be under 130'],
    },
    gender: {
      type: String,
      enum: {
        values: ['Male', 'Female', 'Other'],
        message: '{VALUE} is not a valid gender',
      },
      trim: true,
    },
    abhaId: {
      type: String,
      trim: true,
      sparse: true,
    },
    currentHealthProblem: {
      type: String,
      trim: true,
      default: '',
    },
    healthStatus: {
      type: String,
      trim: true,
      default: 'Stable',
    },
    password: {
      type: String,
      required: function () {
        return this.role === 'doctor';
      },
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/**
 * Encrypt password using bcrypt before saving
 */
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Match user entered password to hashed password in database
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
