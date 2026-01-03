// src/utils/formatters.js
// Formatting utilities for prices and amounts

const { ethers } = require('ethers');

/**
 * Format token amount with proper decimals
 * @param {BigInt} amount - Raw token amount
 * @param {Number} decimals - Token decimals
 * @returns {String} Formatted amount
 */
const formatAmount = (amount, decimals) => {
  const formatted = Number(ethers.formatUnits(amount, decimals));

  if (formatted < 0.01) {
    return formatted.toExponential(4);
  } else if (formatted < 1000) {
    return formatted.toFixed(4);
  } else {
    return formatted.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
};

/**
 * Format price with appropriate decimal places
 * @param {Number} price - Price value
 * @param {Number} decimals - Decimal places
 * @returns {String} Formatted price
 */
const formatPrice = (price, decimals = 12) => {
  return price.toFixed(decimals);
};

/**
 * Format percentage change
 * @param {Number} change - Percentage change
 * @returns {String} Formatted percentage with sign
 */
const formatPercentage = (change) => {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
};

/**
 * Format timestamp
 * @param {Number} timestamp - Unix timestamp
 * @returns {String} Formatted date string
 */
const formatTimestamp = (timestamp) => {
  return new Date(timestamp).toLocaleString();
};

module.exports = {
  formatAmount,
  formatPrice,
  formatPercentage,
  formatTimestamp
};
