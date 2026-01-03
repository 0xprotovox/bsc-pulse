// src/middlewares/validator.js
// Request validation middleware

const validateDynamicTokens = (req, res, next) => {
  const { tokens } = req.body;

  // Validate tokens array exists
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'tokens array is required and must contain at least one token configuration'
    });
  }

  // Validate each token configuration
  const errors = [];
  tokens.forEach((token, index) => {
    if (!token.tokenAddress) {
      errors.push(`Token ${index}: tokenAddress is required`);
    }
    if (!token.poolAddress) {
      errors.push(`Token ${index}: poolAddress is required`);
    }
    if (!token.pair) {
      errors.push(`Token ${index}: pair is required (WBNB, USDC, USDT, BUSD, or agent token)`);
    }
    if (!token.version) {
      errors.push(`Token ${index}: version is required (2 or 3)`);
    }
    if (token.version === 3 && !token.fee) {
      errors.push(`Token ${index}: fee is required for V3 pools`);
    }
  });

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

const validateTokenAddress = (req, res, next) => {
  const { tokenAddress } = req.body;

  if (!tokenAddress) {
    return res.status(400).json({
      success: false,
      error: 'Token address is required'
    });
  }

  next();
};

module.exports = {
  validateDynamicTokens,
  validateTokenAddress
};
