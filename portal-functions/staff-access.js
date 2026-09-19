const inactive = row => row && (row.active === false || row.isActive === false || ['INACTIVE','DISABLED','RETIRED','RESIGNED','SUSPENDED','TERMINATED','LEAVE','ON_LEAVE','퇴사','퇴직','휴직'].includes(String(row.status || '').toUpperCase()) || ['INACTIVE','RETIRED','RESIGNED','TERMINATED','LEAVE','ON_LEAVE','퇴사','퇴직','휴직'].includes(String(row.employmentStatus || '').toUpperCase()));
function staffReadAccess(account) {
  const explicitlyActive = String(account.user?.status || '').toUpperCase() === 'ACTIVE' || account.user?.active === true || account.user?.isActive === true;
  return explicitlyActive && String(account.user?.role || '').toUpperCase() === 'STAFF' && account.access?.apps?.teacherPortal === true && ![account.user,account.profile,account.access].some(inactive);
}
module.exports = {staffReadAccess, inactive};
