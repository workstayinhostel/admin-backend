const Log = require('../models/Log');
const logger = require('../config/logger');

const roleHierarchy = {
  student: 1,
  hostelowner: 2,
  agent: 3,
  admin: 4,
  superadmin: 5,
  founder: 6
};

const isAdminRole = (role) => ['admin', 'superadmin', 'founder'].includes(role);

const normalizeHostelType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['boys', 'male', 'boy'].includes(normalized)) return 'boys';
  if (['girls', 'female', 'girl'].includes(normalized)) return 'girls';
  if (['pg', 'paying guest', 'payingguest'].includes(normalized)) return 'pg';
  return null;
};

const getHostelPermission = (user, hostel) => {
  const isOwner = Boolean(hostel?.owner && hostel.owner.toString() === user?._id?.toString());
  const isAdmin = isAdminRole(user?.role);
  return { isOwner, isAdmin, canManage: isOwner || isAdmin };
};

const roleDeactivationMap = {
  founder: ['superadmin', 'admin', 'agent', 'hostelowner', 'student'],
  superadmin: ['admin', 'agent', 'hostelowner', 'student'],
  admin: ['agent', 'hostelowner', 'student']
};

const canDeactivateUser = (actorRole, targetRole) => {
  return roleDeactivationMap[actorRole]?.includes(targetRole);
};

const canActivateUser = (actorRole, targetRole) => {
  return roleDeactivationMap[actorRole]?.includes(targetRole);
};

const canDeleteUser = (actorRole, targetRole) => {
  if (!actorRole || !targetRole) return false;
  if (actorRole === targetRole) return false;
  return (roleHierarchy[targetRole] || 0) < (roleHierarchy[actorRole] || 0);
};

const createAuditLog = async (payload) => {
  try {
    return await Log.create(payload);
  } catch (error) {
    logger.error('Audit log error:', error);
    return null;
  }
};

const getLogFetchOptions = (queryParams = {}) => {
  const hasPaginationRequest = Object.prototype.hasOwnProperty.call(queryParams, 'page') ||
    Object.prototype.hasOwnProperty.call(queryParams, 'limit');

  const shouldReturnAll = queryParams.all === undefined
    ? !hasPaginationRequest
    : String(queryParams.all).toLowerCase() === 'true';

  const pageValue = Number(queryParams.page) || 1;
  const limitValue = shouldReturnAll ? 0 : (Number(queryParams.limit) || 20);

  return {
    shouldReturnAll,
    pageValue,
    limitValue
  };
};

module.exports = {
  roleHierarchy,
  isAdminRole,
  normalizeHostelType,
  getHostelPermission,
  canDeactivateUser,
  canActivateUser,
  canDeleteUser,
  createAuditLog,
  getLogFetchOptions
};
