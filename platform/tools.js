/* =====================================================================
   EOCO Tools — THE TOOL LIST
   This is the one place that lists every tool on the site. The public
   tools page, the admin dropdown and the complete backup all read it,
   so a new tool only has to be added here (plus its own folder and its
   setup file in /setup) to appear everywhere and be backed up.

   For each tool:
     id        short name, never changes (used in the database)
     name      what people see
     icon      one emoji for the tools page and admin
     summary   one sentence for the tools page
     path      the tool's folder, ending in /
     admin     the tool's admin page
     setupSql  its database setup file (runs after 00-platform.sql)
     backup    the database tables that hold its content, in the order
               they must be restored. "key" is each table's unique
               column; "where" limits a shared table to this tool's rows;
               "count: false" hides it from the overview's numbers.
   ===================================================================== */

(function () {
  // the site's home folder, worked out from where this file lives
  var src = document.currentScript ? document.currentScript.src : '';
  window.EOCO_ROOT = src ? src.replace(/platform\/tools\.js(?:[?#].*)?$/, '') : location.origin + '/';
})();

window.EOCO_PLATFORM = {
  name: 'EOCO Tools',
  setupSql: 'setup/00-platform.sql',
  backup: [
    { table: 'admins',        key: 'email',   label: 'admins' },
    { table: 'tool_settings', key: 'tool_id', label: 'tools page settings', where: { tool_id: 'hub' } }
  ]
};

window.EOCO_TOOLS = [
  {
    id: 'roadmap',
    name: 'Foundational Roadmap',
    icon: '🧭',
    summary: 'A step-by-step checklist for setting up your business the right way, tailored to your province, trade and software.',
    path: 'roadmap/',
    admin: 'roadmap/admin.html',
    setupSql: 'setup/roadmap.sql',
    backup: [
      { table: 'phases',        key: 'name', label: 'phases' },
      { table: 'modules',       key: 'id',   label: 'modules' },
      { table: 'site_settings', key: 'id',   label: 'appearance settings', count: false }
    ]
  },
  {
    id: 'calculator',
    name: 'Real Cost Calculator',
    icon: '🧮',
    summary: 'Work out the true hourly cost of an employee, including vacation pay, CPP, EI and WCB, and download it as a PDF.',
    path: 'newcalculator/',
    admin: 'newcalculator/admin.html',
    setupSql: 'setup/calculator.sql',
    backup: [
      { table: 'tool_settings', key: 'tool_id', label: 'settings',    where: { tool_id: 'calculator' }, count: false },
      { table: 'tool_secrets',  key: 'tool_id', label: 'access code', where: { tool_id: 'calculator' }, count: false }
    ]
  }
];
