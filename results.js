function joinPath(...args) {
    return args.join('/').replace(/\/+/g, '/');
  }

async function loadMonths() {
    const monthSelect = document.getElementById('monthSelect');
    const projectRoot = await window.electronAPI.getProjectRoot();
    const resultsDir = joinPath(projectRoot, 'results');

    const exists = await window.electronAPI.exists(resultsDir);
    if (!exists) {
        monthSelect.innerHTML = '<option value="">No months available</option>';
        return;
    }

    const months = await window.electronAPI.readDir(resultsDir);
    console.log(months);
    const validMonths = months.filter(month => /^\d{4}-\d{2}$/.test(month));
    validMonths.sort().reverse(); 

    monthSelect.innerHTML = validMonths.map(month => `<option value="${month}">${month}</option>`).join('');

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const currentMonth = `${currentYear}-${currentMonthNum.toString().padStart(2, '0')}`;
    if (validMonths.includes(currentMonth)) {
        monthSelect.value = currentMonth;
        await loadCountries(currentMonth);
    }
}

async function loadCountries(month) {
    const countrySelect = document.getElementById('countrySelect');
    const projectRoot = await window.electronAPI.getProjectRoot();
    const monthDir = joinPath(projectRoot, 'results', month);

    const exists = await window.electronAPI.exists(monthDir);
    if (!exists) {
        countrySelect.innerHTML = '<option value="">No countries available</option>';
        return;
    }

    const countries = await window.electronAPI.readDir(monthDir);
    const validCountries = countries.filter(country => {
        const countryDir = joinPath(monthDir, country);
        return window.electronAPI.exists(joinPath(countryDir, 'result.txt'));
    });

    countrySelect.innerHTML = '<option value="">-- Select a country --</option>';
    if (validCountries.length > 0) {
        countrySelect.innerHTML += validCountries.map(country => `<option value="${country}">${country}</option>`).join('');
    }
}

async function loadResultDetails(month, country) {
    const logContent = document.getElementById('logContent');

    const projectRoot = await window.electronAPI.getProjectRoot();
    const countryDir = joinPath(projectRoot, 'results', month, country);
    const resultFilePath = joinPath(countryDir, 'result.txt');

    const exists = await window.electronAPI.exists(resultFilePath);
    if (exists) {
        const log = await window.electronAPI.readTextFile(resultFilePath);

        logContent.innerHTML = `<pre>${log.toString()}</pre>`;
    } else {
        logContent.textContent = 'Log not available';
    }

    resultDetails.style.display = 'block';
}

