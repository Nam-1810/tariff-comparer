async function comparedFiles(rootPath, currentMonth, previousMonth, pdfjsLib) {
    const statusElement = document.getElementById('status');
    const changedList = document.getElementById('changedList');
    const unchangedList = document.getElementById('unchangedList');
    const missingList = document.getElementById('missingList');

    if (!rootPath) {
        statusElement.textContent = 'Error: rootPath is empty or undefined. Please check file-config.txt.\n';
        return;
    }

    const currentMonthPath = joinPath(rootPath, 'CMA', currentMonth);
    const previousMonthPath = joinPath(rootPath, 'CMA', previousMonth);

    const currentExists = await window.electronAPI.exists(currentMonthPath);
    const previousExists = await window.electronAPI.exists(previousMonthPath);

    if (!currentExists || !previousExists) {
        statusElement.textContent = 'One or both month directories are missing.\n';
        return;
    }

    const currentCountries = await window.electronAPI.readDir(currentMonthPath);
    const previousCountries = await window.electronAPI.readDir(previousMonthPath);
    const changedCountries = [];
    const unchangedCountries = [];
    const missingCountries = [];
    let logContent = '';

    const allCountries = [...new Set([...currentCountries, ...previousCountries])];

    const countryPromises = allCountries.map(async country => {
        const currentFilePath = joinPath(currentMonthPath, country, 'tariff.pdf');
        
        const previousFilePath = joinPath(previousMonthPath, country, 'tariff.pdf');

        const currentFileExists = await window.electronAPI.exists(currentFilePath);
        const previousFileExists = await window.electronAPI.exists(previousFilePath);

        if (!currentFileExists && !previousFileExists) {
            return null; 
        } else if (!currentFileExists || !previousFileExists) {
            return {
                type: 'missing',
                data: { country, missingIn: !currentFileExists ? currentMonth : previousMonth }
            };
        }
        const currentMetadata = await getPDFMetadata(currentFilePath, pdfjsLib, country);
        const previousMetadata = await getPDFMetadata(previousFilePath, pdfjsLib, country);

        if (areMetadataEqual(currentMetadata, previousMetadata)) {
            return { type: 'unchanged', data: country };
        } else {
            return { type: 'changed', data: { country, currentFilePath, previousFilePath } };
        }
    });

    const results = await Promise.all(countryPromises);

   
    results.forEach(result => {
        if (!result) return; 
        switch (result.type) {
            case 'missing':
                missingCountries.push(result.data);
                break;
            case 'unchanged':
                unchangedCountries.push(result.data);
                break;
            case 'changed':
                changedCountries.push(result.data);
                break;
        }
    });

    changedList.innerHTML = '';
    if (changedCountries.length === 0) {
        changedList.innerHTML = '<li>No countries with changes.</li>';
    } else {
        const li = document.createElement('li');
        const countryNames = changedCountries.map(item => item.country).join(', ');
        const countryData = JSON.stringify(changedCountries);
        li.innerHTML = `${countryNames} <button id="sendtoAI" data-countries='${countryData}'>Send to AI</button>`;
        changedList.appendChild(li);
    }

    unchangedList.innerHTML = '';
    if (unchangedCountries.length === 0) {
        unchangedList.innerHTML = '<li>No countries without changes.</li>';
    } else {
        const li = document.createElement('li');
        li.textContent = unchangedCountries.join(', ');
        unchangedList.appendChild(li);
    }

    missingList.innerHTML = '';
    if (missingCountries.length === 0) {
        missingList.innerHTML = '<li>No missing country files.</li>';
    } else {
        const li = document.createElement('li');
        const missingDetails = missingCountries.map(item => `${item.country} (missing in ${item.missingIn})`).join(', ');
        li.textContent = missingDetails;
        missingList.appendChild(li);
    }

    statusElement.textContent = logContent;
}