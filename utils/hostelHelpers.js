const generateHostelCode = (existingCodes = [], prefix = process.env.HOSTEL_CODE_PREFIX || 'SIH') => {
  const normalizedPrefix = String(prefix || 'SIH').toUpperCase();
  const codes = Array.isArray(existingCodes) ? existingCodes : [];
  const parsed = codes
    .map(code => String(code || '').trim().toUpperCase())
    .filter(code => code.startsWith(normalizedPrefix))
    .map(code => Number(code.slice(normalizedPrefix.length)))
    .filter(number => Number.isInteger(number) && number > 0)
    .sort((a, b) => a - b);

  let next = 101;
  if (parsed.length) {
    const max = Math.max(...parsed);
    next = max + 1;
  }

  return `${normalizedPrefix}${next}`;
};

module.exports = { generateHostelCode };
