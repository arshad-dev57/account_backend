/**
 * Validation Middleware
 * Reusable validation rules for common fields
 */

const validate = (schema) => {
  return (req, res, next) => {
    const errors = [];
    const { body, params, query } = req;

    // Validate body fields
    if (schema.body) {
      for (const [field, rules] of Object.entries(schema.body)) {
        const value = body[field];

        if (rules.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} is required`);
          continue;
        }

        if (value && rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }

        if (value && rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must not exceed ${rules.maxLength} characters`);
        }

        if (value && rules.pattern && !rules.pattern.test(value)) {
          errors.push(rules.message || `${field} format is invalid`);
        }

        if (value && rules.custom) {
          const customError = rules.custom(value, body);
          if (customError) errors.push(customError);
        }
      }
    }

    // Validate params fields
    if (schema.params) {
      for (const [field, rules] of Object.entries(schema.params)) {
        const value = params[field];

        if (rules.required && !value) {
          errors.push(`${field} is required`);
        }

        if (value && rules.pattern && !rules.pattern.test(value)) {
          errors.push(rules.message || `${field} format is invalid`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    next();
  };
};

// Common validation rules
const rules = {
  email: {
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Please provide a valid email address',
  },
  password: {
    required: true,
    minLength: 6,
    message: 'Password must be at least 6 characters',
  },
  name: {
    required: true,
    minLength: 2,
    maxLength: 50,
    message: 'Name must be between 2 and 50 characters',
  },
  phone: {
    pattern: /^[+]?[\d\s()-]+$/,
    message: 'Please provide a valid phone number',
  },
  id: {
    required: true,
    pattern: /^[0-9a-fA-F]{24}$/,
    message: 'Invalid ID format',
  },
};

// Pre-built validation schemas
const schemas = {
  register: {
    body: {
      firstName: { ...rules.name, required: true },
      lastName: { ...rules.name, required: true },
      email: rules.email,
      password: rules.password,
      country: { required: true, minLength: 2 },
      phone: rules.phone,
      address: { maxLength: 200 },
      organizationName: { maxLength: 100 },
    },
  },
  login: {
    body: {
      email: rules.email,
      password: { required: true },
    },
  },
  changePassword: {
    body: {
      currentPassword: { required: true },
      newPassword: { ...rules.password, required: true },
    },
  },
  forgotPassword: {
    body: {
      email: rules.email,
    },
  },
  verifyOTP: {
    body: {
      email: rules.email,
      otp: { required: true, pattern: /^\d{6}$/, message: 'OTP must be 6 digits' },
    },
  },
  resetPassword: {
    body: {
      newPassword: { ...rules.password, required: true },
      confirmPassword: { required: true },
    },
  },
};

module.exports = { validate, rules, schemas };