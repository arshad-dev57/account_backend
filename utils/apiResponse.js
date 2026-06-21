/**
 * Standardized API Response Utility
 * Ensures consistent response format across all APIs
 */
class ApiResponse {
  static success(res, statusCode, message, data = null, meta = null) {
    const response = {
      success: true,
      message,
      data,
    };

    if (meta) {
      response.meta = meta;
    }

    return res.status(statusCode).json(response);
  }

  static error(res, statusCode, message, errors = null, code = null) {
    const response = {
      success: false,
      message,
    };

    if (errors) {
      response.errors = errors;
    }

    if (code) {
      response.code = code;
    }

    return res.status(statusCode).json(response);
  }

  // Convenience methods
  static ok(res, message, data) {
    return this.success(res, 200, message, data);
  }

  static created(res, message, data) {
    return this.success(res, 201, message, data);
  }

  static badRequest(res, message, errors) {
    return this.error(res, 400, message, errors);
  }

  static unauthorized(res, message = 'Unauthorized') {
    return this.error(res, 401, message);
  }

  static forbidden(res, message = 'Forbidden') {
    return this.error(res, 403, message);
  }

  static notFound(res, message = 'Resource not found') {
    return this.error(res, 404, message);
  }

  static serverError(res, message = 'Internal server error', error = null) {
    const response = {
      success: false,
      message,
    };

    if (error && process.env.NODE_ENV === 'development') {
      response.error = error.message || error;
    }

    return res.status(500).json(response);
  }
}

module.exports = ApiResponse;