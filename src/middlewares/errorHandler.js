// src/middlewares/errorHandler.js
// Centralized error handling middleware

const errorHandler = (metricsCollector) => {
  return (err, req, res, next) => {
    console.error('Express error:', err.message);

    // Track error in metrics if available
    if (metricsCollector) {
      metricsCollector.addError(err);
    }

    // Determine status code
    const statusCode = err.statusCode || 500;

    // Send error response
    res.status(statusCode).json({
      success: false,
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  };
};

module.exports = errorHandler;
