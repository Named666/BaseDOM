// state.js

let currentEffect = null;

/**
 * Creates a reactive signal containing a value.
 * If the first argument is a string, it becomes a persistent signal stored in sessionStorage.
 * @param {string|*} nameOrValue - The key for persistent state or the initial value for a transient signal.
 * @param {*} [initialValueIfPersistent] - The initial value if the signal is persistent. This is ignored for transient signals.
 * @returns {[Function, Function]} A tuple containing a getter and a setter function.
 */
export function signal(nameOrValue, initialValueIfPersistent) {
    const isPersistent = typeof nameOrValue === 'string' && initialValueIfPersistent !== undefined;
    // If it's a persistent signal, use the name as the key and the initial value as
    const key = isPersistent ? nameOrValue : null;
    let value = isPersistent ? initialValueIfPersistent : nameOrValue;

    // For persistent signals, try to load the value from sessionStorage.
    if (isPersistent) {
        try {
            const storedValue = sessionStorage.getItem(key);
            if (storedValue !== null) {
                // Use the stored value if it exists.
                value = JSON.parse(storedValue);
            }
        } catch (e) {
            console.error(`Error parsing stored signal "${key}":`, e);
            // If parsing fails, we'll stick with the initialValueIfPersistent.
        }
    }

    const dependents = new Set();

    const get = () => {
        // If there's an active effect, register it as a dependent.
        if (currentEffect) {
            dependents.add(currentEffect);
            // The effect also tracks a cleanup function for this dependency.
            currentEffect.dependencies.add(() => dependents.delete(currentEffect));
        }
        return value;
    };

    const set = (setter) => {
        // Allow the setter to be a value or a function that receives the previous value.
        const newValue = typeof setter === 'function' ? setter(value) : setter;

        // Only trigger updates if the value has actually changed.
        if (!Object.is(value, newValue)) {
            value = newValue;

            // If the signal is persistent, save the new value to sessionStorage.
            if (isPersistent) {
                try {
                    sessionStorage.setItem(key, JSON.stringify(value));
                } catch (e) {
                    console.error(`Error saving signal "${key}":`, e);
                }
            }

            // Run all dependent effects.
            // Iterate over a copy to prevent issues if an effect modifies the Set.
            for (const effectRunner of [...dependents]) {
                effectRunner();
            }
        }
    };

    return [get, set];
}


/**
 * Creates a function that runs automatically when its tracked signals change.
 * It handles its own dependency cleanup to prevent memory leaks.
 * @param {Function} fn The function to run as an effect.
 * @returns {Function} A `dispose` function to manually stop the effect.
 */
export function effect(fn) {
    let disposed = false;

    const cleanupDependencies = () => {
        // Run all cleanup functions for previous dependencies and clear the set.
        runner.dependencies.forEach(cleanupFn => cleanupFn());
        runner.dependencies.clear();
    };

    const runner = () => {
        if (disposed) return;

        // Clean up previous dependencies before re-running the effect.
        cleanupDependencies();

        // Set this runner as the `currentEffect` to be tracked by signals.
        const prevEffect = currentEffect;
        currentEffect = runner;
        try {
            // Run the user's function. Any `get()` calls inside will register dependencies.
            fn();
        } finally {
            // Restore the previous effect context.
            currentEffect = prevEffect;
        }
    };

    runner.dependencies = new Set();

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        cleanupDependencies();
    };

    // If this effect is being created inside another running effect,
    // register its dispose function to be called when the parent cleans up.
    if (currentEffect) {
        currentEffect.dependencies.add(dispose);
    }

    // Run the effect once to establish initial dependencies.
    runner();

    // Return a `dispose` function for manual cleanup (e.g., in onUnmount).
    return dispose;
}

/**
 * Creates a memoized, read-only signal that re-computes its value only when
 * its underlying dependencies change.
 * @param {Function} fn The function to compute the value.
 * @returns {Function} A getter function for the computed value.
 */
export function computed(fn) {
    const [value, setValue] = signal(fn());
    effect(() => setValue(fn()));

    // Return only the getter to make it read-only.
    return value;
}

/**
 * A flexible global store for app state, supporting keyed values, tabular data, schema enforcement, listeners, and transactions.
 * Good for global settings, user info, and structured or tabular data.
 * @param {object} initialState The initial state of the store (optional, with `values` and `tables` keys).
 * @returns {object} Store API with methods for:
 *   - Keyed values: getValues, getValueIds, getValue, setValues, setValue, delValue, delValues, addValueListener, addValuesListener, addValueIdsListener
 *   - Tabular data: getTables, getTableIds, getTable, setTables, setTable, delTable, delTables, addTableListener, addTablesListener, addTableIdsListener
 *   - Rows/cells: getRowIds, getRow, setRow, delRow, addRowListener, addRowIdsListener, getCellIds, getCell, setCell, delCell, addCellListener, addCellIdsListener
 *   - Table cell helpers: getTableCellIds, addTableCellIdsListener, getSortedRowIds, addSortedRowIdsListener
 *   - Existence/convenience: hasValue, hasTable, hasRow, hasCell, forEachValue, forEachTable, forEachRow, forEachCell, addHasValueListener, addHasTableListener, addHasRowListener, addHasCellListener
 *   - Listener stats: getListenerStats
 *   - Schema: setValuesSchema, getValuesSchema, setTablesSchema, getTablesSchema
 *   - Partial updates: setPartialValues, setPartialRow, addRow
 *   - Invalid data listeners: addInvalidValueListener, addInvalidCellListener
 *   - Transactions: transaction
 *   - Serialization: setJson, getJson, getSchemaJson
 *   - Manual listener trigger: callListener
 *   - Schema/listener removal: delValuesSchema, delTablesSchema, delListener
 */
export function createStore(initialState = {}) {
    // Keyed values
    let values = { ...(initialState.values || {}) };
    // Tabular data: { tableId: { rowId: { cellId: value } } }
    let tables = { ...(initialState.tables || {}) };

    // Listeners: { type: { id: Map<listenerId, fn> } }
    let _listenerId = 1;
    function genListenerId() { return 'l' + (_listenerId++); }
    const listeners = {
        value: new Map(),      // valueId -> Map<listenerId, fn>
        values: new Map(),     // all values: listenerId -> fn
        table: new Map(),      // tableId -> Map<listenerId, fn>
        tables: new Map(),     // all tables: listenerId -> fn
        row: new Map(),        // `${tableId}:${rowId}` -> Map<listenerId, fn>
        cell: new Map(),       // `${tableId}:${rowId}:${cellId}` -> Map<listenerId, fn>
    };

    // --- Keyed Values API ---
    function getValues() {
        return { ...values };
    }
    function getValueIds() {
        return Object.keys(values);
    }
    function getValue(id) {
        return values[id];
    }
    function setValues(newValues) {
        // Enforce schema if present
        if (Object.keys(valuesSchema).length) {
            values = enforceValueSchema(newValues);
        } else {
            values = { ...newValues };
        }
        if (inTransaction) {
            transactionQueue.push({ type: 'values' });
        } else {
            listeners.values.forEach(fn => {
                try { fn(getValues()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function setValue(id, val) {
        let newVal = val;
        if (valuesSchema[id]) {
            const { type, default: def } = valuesSchema[id];
            if (typeof val !== type) {
                newVal = (def !== undefined && typeof def === type) ? def : undefined;
            }
        }
        const old = values[id];
        values[id] = newVal;
        if (inTransaction) {
            transactionQueue.push({ type: 'value', id, newVal, old });
            transactionQueue.push({ type: 'values' });
        } else {
            if (listeners.value.get(id)) listeners.value.get(id).forEach(fn => {
                try { fn(newVal, old); } catch (e) { console.error('Listener error:', e); }
            });
            listeners.values.forEach(fn => {
                try { fn(getValues()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function delValue(id) {
        const old = values[id];
        delete values[id];
        if (inTransaction) {
            transactionQueue.push({ type: 'value', id, newVal: undefined, old });
            transactionQueue.push({ type: 'values' });
        } else {
            if (listeners.value.get(id)) listeners.value.get(id).forEach(fn => {
                try { fn(undefined, old); } catch (e) { console.error('Listener error:', e); }
            });
            listeners.values.forEach(fn => {
                try { fn(getValues()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function delValues() {
        const oldValues = { ...values };
        values = {};
        if (inTransaction) {
            for (const id in oldValues) {
                transactionQueue.push({ type: 'value', id, newVal: undefined, old: oldValues[id] });
            }
            transactionQueue.push({ type: 'values' });
        } else {
            for (const id in oldValues) {
                if (listeners.value.get(id)) listeners.value.get(id).forEach(fn => {
                    try { fn(undefined, oldValues[id]); } catch (e) { console.error('Listener error:', e); }
                });
            }
            listeners.values.forEach(fn => {
                try { fn(getValues()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function addValueListener(id, fn) {
        if (!listeners.value.has(id)) listeners.value.set(id, new Map());
        const listenerId = genListenerId();
        listeners.value.get(id).set(listenerId, fn);
        return listenerId;
    }
    function addValuesListener(fn) {
        const listenerId = genListenerId();
        listeners.values.set(listenerId, fn);
        return listenerId;
    }
    function addValueIdsListener(fn) {
        // Notifies when value IDs change
        let prev = getValueIds();
        const check = () => {
            const now = getValueIds();
            if (now.join() !== prev.join()) {
                fn(now, prev);
                prev = now;
            }
        };
        const listenerId = genListenerId();
        listeners.values.set(listenerId, check);
        return listenerId;
    }

    // --- Tabular Data API ---
    function getTables() {
        return JSON.parse(JSON.stringify(tables));
    }
    function getTableIds() {
        return Object.keys(tables);
    }
    function getTable(tableId) {
        return tables[tableId] ? { ...tables[tableId] } : undefined;
    }
    function setTables(newTables) {
        tables = { ...newTables };
        if (inTransaction) {
            transactionQueue.push({ type: 'tables' });
        } else {
            listeners.tables.forEach(fn => {
                try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function setTable(tableId, table) {
        tables[tableId] = { ...table };
        if (inTransaction) {
            transactionQueue.push({ type: 'table', tableId });
            transactionQueue.push({ type: 'tables' });
        } else {
            if (listeners.table.get(tableId)) listeners.table.get(tableId).forEach(fn => {
                try { fn(getTable(tableId)); } catch (e) { console.error('Listener error:', e); }
            });
            listeners.tables.forEach(fn => {
                try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function delTable(tableId) {
        delete tables[tableId];
        if (inTransaction) {
            transactionQueue.push({ type: 'table', tableId, deleted: true });
            transactionQueue.push({ type: 'tables' });
        } else {
            if (listeners.table.get(tableId)) listeners.table.get(tableId).forEach(fn => {
                try { fn(undefined); } catch (e) { console.error('Listener error:', e); }
            });
            listeners.tables.forEach(fn => {
                try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function delTables() {
        const oldTables = { ...tables };
        tables = {};
        if (inTransaction) {
            for (const tableId in oldTables) {
                transactionQueue.push({ type: 'table', tableId, deleted: true });
            }
            transactionQueue.push({ type: 'tables' });
        } else {
            for (const tableId in oldTables) {
                if (listeners.table.get(tableId)) listeners.table.get(tableId).forEach(fn => {
                    try { fn(undefined); } catch (e) { console.error('Listener error:', e); }
                });
            }
            listeners.tables.forEach(fn => {
                try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function addTableListener(tableId, fn) {
        if (!listeners.table.has(tableId)) listeners.table.set(tableId, new Map());
        const listenerId = genListenerId();
        listeners.table.get(tableId).set(listenerId, fn);
        return listenerId;
    }
    function addTablesListener(fn) {
        const listenerId = genListenerId();
        listeners.tables.set(listenerId, fn);
        return listenerId;
    }
    function addTableIdsListener(fn) {
        // Notifies when table IDs change
        let prev = getTableIds();
        const check = () => {
            const now = getTableIds();
            if (now.join() !== prev.join()) {
                fn(now, prev);
                prev = now;
            }
        };
        const listenerId = genListenerId();
        listeners.tables.set(listenerId, check);
        return listenerId;
    }

    // --- Row/Cell API ---
    function getRowIds(tableId) {
        return tables[tableId] ? Object.keys(tables[tableId]) : [];
    }
    function getRow(tableId, rowId) {
        return tables[tableId]?.[rowId] ? { ...tables[tableId][rowId] } : undefined;
    }
    function setRow(tableId, rowId, row) {
        if (!tables[tableId]) tables[tableId] = {};
        // Enforce schema if present
        if (tablesSchema[tableId]) {
            tables[tableId][rowId] = enforceTableSchema(tableId, row);
        } else {
            tables[tableId][rowId] = { ...row };
        }
        const key = `${tableId}:${rowId}`;
        if (inTransaction) {
            transactionQueue.push({ type: 'row', tableId, rowId });
        } else {
            if (listeners.row.get(key)) listeners.row.get(key).forEach(fn => {
                try { fn(getRow(tableId, rowId)); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function delRow(tableId, rowId) {
        if (tables[tableId]) {
            delete tables[tableId][rowId];
            const key = `${tableId}:${rowId}`;
            if (inTransaction) {
                transactionQueue.push({ type: 'row', tableId, rowId, deleted: true });
                transactionQueue.push({ type: 'table', tableId });
                transactionQueue.push({ type: 'tables' });
            } else {
                if (listeners.row.get(key)) listeners.row.get(key).forEach(fn => {
                    try { fn(undefined); } catch (e) { console.error('Listener error:', e); }
                });
                if (listeners.table.get(tableId)) listeners.table.get(tableId).forEach(fn => {
                    try { fn(getTable(tableId)); } catch (e) { console.error('Listener error:', e); }
                });
                listeners.tables.forEach(fn => {
                    try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
                });
            }
        }
        return api;
    }
    function addRowListener(tableId, rowId, fn) {
        const key = `${tableId}:${rowId}`;
        if (!listeners.row.has(key)) listeners.row.set(key, new Map());
        const listenerId = genListenerId();
        listeners.row.get(key).set(listenerId, fn);
        return listenerId;
    }
    function addRowIdsListener(tableId, fn) {
        // Notifies when row IDs change
        let prev = getRowIds(tableId);
        const check = () => {
            const now = getRowIds(tableId);
            if (now.join() !== prev.join()) {
                fn(now, prev);
                prev = now;
            }
        };
        if (!listeners.table.has(tableId)) listeners.table.set(tableId, new Map());
        const listenerId = genListenerId();
        listeners.table.get(tableId).set(listenerId, check);
        return listenerId;
    }

    function getCellIds(tableId, rowId) {
        return tables[tableId]?.[rowId] ? Object.keys(tables[tableId][rowId]) : [];
    }
    function getTableCellIds(tableId) {
        // Returns an object: { rowId: [cellIds...] }
        const result = {};
        if (tables[tableId]) {
            for (const rowId of Object.keys(tables[tableId])) {
                result[rowId] = Object.keys(tables[tableId][rowId]);
            }
        }
        return result;
    }
    function getCell(tableId, rowId, cellId) {
        return tables[tableId]?.[rowId]?.[cellId];
    }
    function setCell(tableId, rowId, cellId, value) {
        if (!tables[tableId]) tables[tableId] = {};
        if (!tables[tableId][rowId]) tables[tableId][rowId] = {};
        let newValue = value;
        // Enforce schema if present
        if (tablesSchema[tableId] && tablesSchema[tableId][cellId]) {
            const { type, default: def } = tablesSchema[tableId][cellId];
            if (typeof value !== type) {
                newValue = (def !== undefined && typeof def === type) ? def : undefined;
            }
        }
        const old = tables[tableId][rowId][cellId];
        tables[tableId][rowId][cellId] = newValue;
        const key = `${tableId}:${rowId}:${cellId}`;
        if (inTransaction) {
            transactionQueue.push({ type: 'cell', tableId, rowId, cellId, newValue, old });
        } else {
            if (listeners.cell.get(key)) listeners.cell.get(key).forEach(fn => {
                try { fn(newValue, old); } catch (e) { console.error('Listener error:', e); }
            });
        }
        return api;
    }
    function delCell(tableId, rowId, cellId) {
        if (tables[tableId]?.[rowId]) {
            const old = tables[tableId][rowId][cellId];
            delete tables[tableId][rowId][cellId];
            const key = `${tableId}:${rowId}:${cellId}`;
            if (inTransaction) {
                transactionQueue.push({ type: 'cell', tableId, rowId, cellId, newValue: undefined, old });
                transactionQueue.push({ type: 'row', tableId, rowId });
                transactionQueue.push({ type: 'table', tableId });
                transactionQueue.push({ type: 'tables' });
            } else {
                if (listeners.cell.get(key)) listeners.cell.get(key).forEach(fn => {
                    try { fn(undefined, old); } catch (e) { console.error('Listener error:', e); }
                });
                const rowKey = `${tableId}:${rowId}`;
                if (listeners.row.get(rowKey)) listeners.row.get(rowKey).forEach(fn => {
                    try { fn(getRow(tableId, rowId)); } catch (e) { console.error('Listener error:', e); }
                });
                if (listeners.table.get(tableId)) listeners.table.get(tableId).forEach(fn => {
                    try { fn(getTable(tableId)); } catch (e) { console.error('Listener error:', e); }
                });
                listeners.tables.forEach(fn => {
                    try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
                });
            }
        }
        return api;
    }
    function addCellListener(tableId, rowId, cellId, fn) {
        const key = `${tableId}:${rowId}:${cellId}`;
        if (!listeners.cell.has(key)) listeners.cell.set(key, new Map());
        const listenerId = genListenerId();
        listeners.cell.get(key).set(listenerId, fn);
        return listenerId;
    }
    function addCellIdsListener(tableId, rowId, fn) {
        // Notifies when cell IDs change
        let prev = getCellIds(tableId, rowId);
        const check = () => {
            const now = getCellIds(tableId, rowId);
            if (now.join() !== prev.join()) {
                fn(now, prev);
                prev = now;
            }
        };
        const key = `${tableId}:${rowId}`;
        if (!listeners.row.has(key)) listeners.row.set(key, new Map());
        const listenerId = genListenerId();
        listeners.row.get(key).set(listenerId, check);
        return listenerId;
    }
    function addTableCellIdsListener(tableId, fn) {
        // Notifies when any row's cell IDs change in the table
        const rowIds = getRowIds(tableId);
        const listenerIds = [];
        for (const rowId of rowIds) {
            listenerIds.push(addCellIdsListener(tableId, rowId, () => {
                fn(getTableCellIds(tableId));
            }));
        }
        // Listen for new/deleted rows
        const rowIdsListenerId = addRowIdsListener(tableId, () => {
            // Remove previous listeners
            listenerIds.forEach(delListener);
            // Subscribe to new set
            const newRowIds = getRowIds(tableId);
            for (const rowId of newRowIds) {
                listenerIds.push(addCellIdsListener(tableId, rowId, () => {
                    fn(getTableCellIds(tableId));
                }));
            }
            fn(getTableCellIds(tableId));
        });
        // Initial call
        fn(getTableCellIds(tableId));
        // Return a group ID (array of IDs)
        return [rowIdsListenerId, ...listenerIds];
    }
    function getSortedRowIds(tableId, compareFn) {
        const rowIds = getRowIds(tableId);
        if (typeof compareFn === 'function') {
            return [...rowIds].sort((a, b) => compareFn(getRow(tableId, a), getRow(tableId, b), a, b));
        }
        return [...rowIds].sort();
    }
    function addSortedRowIdsListener(tableId, fn, compareFn) {
        let prev = getSortedRowIds(tableId, compareFn);
        const check = () => {
            const now = getSortedRowIds(tableId, compareFn);
            if (now.join() !== prev.join()) {
                fn(now, prev);
                prev = now;
            }
        };
        // Listen for row ID changes and row data changes
        const rowIdsListenerId = addRowIdsListener(tableId, check);
        const rowIds = getRowIds(tableId);
        const rowListenerIds = rowIds.map(rowId => addRowListener(tableId, rowId, check));
        return [rowIdsListenerId, ...rowListenerIds];
    }

    // --- Existence helpers ---
    function hasValue(id) {
        return Object.prototype.hasOwnProperty.call(values, id);
    }
    function hasTable(tableId) {
        return Object.prototype.hasOwnProperty.call(tables, tableId);
    }
    function hasRow(tableId, rowId) {
        return !!tables[tableId] && Object.prototype.hasOwnProperty.call(tables[tableId], rowId);
    }
    function hasCell(tableId, rowId, cellId) {
        return !!tables[tableId]?.[rowId] && Object.prototype.hasOwnProperty.call(tables[tableId][rowId], cellId);
    }

    // --- Iterators ---
    function forEachValue(fn) {
        for (const id in values) {
            fn(values[id], id);
        }
    }
    function forEachTable(fn) {
        for (const tableId in tables) {
            fn(tables[tableId], tableId);
        }
    }
    function forEachRow(tableId, fn) {
        if (!tables[tableId]) return;
        for (const rowId in tables[tableId]) {
            fn(tables[tableId][rowId], rowId);
        }
    }
    function forEachCell(tableId, rowId, fn) {
        if (!tables[tableId]?.[rowId]) return;
        for (const cellId in tables[tableId][rowId]) {
            fn(tables[tableId][rowId][cellId], cellId);
        }
    }

    // --- Existence listeners ---
    function addHasValueListener(id, fn) {
        let prev = hasValue(id);
        const check = () => {
            const now = hasValue(id);
            if (now !== prev) {
                fn(now, prev);
                prev = now;
            }
        };
        const listenerId = genListenerId();
        listeners.values.set(listenerId, check);
        return listenerId;
    }
    function addHasTableListener(tableId, fn) {
        let prev = hasTable(tableId);
        const check = () => {
            const now = hasTable(tableId);
            if (now !== prev) {
                fn(now, prev);
                prev = now;
            }
        };
        const listenerId = genListenerId();
        listeners.tables.set(listenerId, check);
        return listenerId;
    }
    function addHasRowListener(tableId, rowId, fn) {
        let prev = hasRow(tableId, rowId);
        const check = () => {
            const now = hasRow(tableId, rowId);
            if (now !== prev) {
                fn(now, prev);
                prev = now;
            }
        };
        if (!listeners.table.has(tableId)) listeners.table.set(tableId, new Map());
        const listenerId = genListenerId();
        listeners.table.get(tableId).set(listenerId, check);
        return listenerId;
    }
    function addHasCellListener(tableId, rowId, cellId, fn) {
        let prev = hasCell(tableId, rowId, cellId);
        const check = () => {
            const now = hasCell(tableId, rowId, cellId);
            if (now !== prev) {
                fn(now, prev);
                prev = now;
            }
        };
        const key = `${tableId}:${rowId}`;
        if (!listeners.row.has(key)) listeners.row.set(key, new Map());
        const listenerId = genListenerId();
        listeners.row.get(key).set(listenerId, check);
        return listenerId;
    }

    // --- Listener stats for debugging ---
    function getListenerStats() {
        return {
            value: Array.from(listeners.value.values()).reduce((a, m) => a + (m.size || 0), 0),
            values: listeners.values.size,
            table: Array.from(listeners.table.values()).reduce((a, m) => a + (m.size || 0), 0),
            tables: listeners.tables.size,
            row: Array.from(listeners.row.values()).reduce((a, m) => a + (m.size || 0), 0),
            cell: Array.from(listeners.cell.values()).reduce((a, m) => a + (m.size || 0), 0),
        };
    }

    // --- Schema support ---
    let valuesSchema = {};
    let tablesSchema = {};

    function setValuesSchema(schema) {
        valuesSchema = { ...schema };
        // Re-validate current values
        setValues(values);
        return api;
    }
    function getValuesSchema() {
        return { ...valuesSchema };
    }
    function setTablesSchema(schema) {
        tablesSchema = { ...schema };
        // Re-validate current tables
        setTables(tables);
        return api;
    }
    function getTablesSchema() {
        return { ...tablesSchema };
    }

    // --- Schema enforcement helpers ---
    function enforceValueSchema(obj) {
        const result = {};
        for (const key in valuesSchema) {
            const { type, default: def } = valuesSchema[key];
            if (typeof obj[key] === type) {
                result[key] = obj[key];
            } else if (def !== undefined && typeof def === type) {
                result[key] = def;
            }
        }
        return result;
    }
    function enforceTableSchema(tableId, rowObj) {
        const schema = tablesSchema[tableId];
        if (!schema) return {};
        const result = {};
        for (const cellId in schema) {
            const { type, default: def } = schema[cellId];
            if (typeof rowObj[cellId] === type) {
                result[cellId] = rowObj[cellId];
            } else if (def !== undefined && typeof def === type) {
                result[cellId] = def;
            }
        }
        return result;
    }

    // --- Partial update methods ---
    function setPartialValues(partial) {
        for (const key in partial) {
            setValue(key, partial[key]);
        }
    }
    function setPartialRow(tableId, rowId, partial) {
        const row = getRow(tableId, rowId) || {};
        setRow(tableId, rowId, { ...row, ...partial });
    }

    // --- Add row with auto ID ---
    function addRow(tableId, row) {
        if (!tables[tableId]) tables[tableId] = {};
        let newId;
        do {
            newId = Math.random().toString(36).slice(2, 10);
        } while (tables[tableId][newId]);
        setRow(tableId, newId, row);
        return newId;
    }

    // --- Invalid data listeners ---
    const invalidValueListeners = new Set();
    const invalidCellListeners = new Set();
    function addInvalidValueListener(fn) {
        invalidValueListeners.add(fn);
        return () => invalidValueListeners.delete(fn);
    }
    function addInvalidCellListener(fn) {
        invalidCellListeners.add(fn);
        return () => invalidCellListeners.delete(fn);
    }

    // --- Transaction support ---
    let inTransaction = false;
    let transactionQueue = [];
    function transaction(fn) {
        inTransaction = true;
        try {
            fn();
        } finally {
            inTransaction = false;
            // Fire all listeners only once per type, in correct order
            const types = new Set(transactionQueue.map(e => e.type));

            // 1. Fire value listeners
            for (const event of transactionQueue) {
                if (event.type === 'value') {
                    const valueListeners = listeners.value.get(event.id);
                    if (valueListeners) {
                        valueListeners.forEach(fn => {
                            try { fn(event.newVal, event.old); } catch (e) { console.error('Listener error:', e); }
                        });
                    }
                }
            }

            // 2. Fire values listeners if needed
            if (types.has('values')) {
                listeners.values.forEach(fn => {
                    try { fn(getValues()); } catch (e) { console.error('Listener error:', e); }
                });
            }

            // 3. Fire table listeners
            for (const event of transactionQueue) {
                if (event.type === 'table') {
                    const tableListeners = listeners.table.get(event.tableId);
                    if (tableListeners) {
                        tableListeners.forEach(fn => {
                            try {
                                if (event.deleted) {
                                    fn(undefined);
                                } else {
                                    fn(getTable(event.tableId));
                                }
                            } catch (e) { console.error('Listener error:', e); }
                        });
                    }
                }
            }

            // 4. Fire row listeners
            for (const event of transactionQueue) {
                if (event.type === 'row') {
                    const rowKey = `${event.tableId}:${event.rowId}`;
                    const rowListeners = listeners.row.get(rowKey);
                    if (rowListeners) {
                        rowListeners.forEach(fn => {
                            try {
                                if (event.deleted) {
                                    fn(undefined);
                                } else {
                                    fn(getRow(event.tableId, event.rowId));
                                }
                            } catch (e) { console.error('Listener error:', e); }
                        });
                    }
                }
            }

            // 5. Fire cell listeners
            for (const event of transactionQueue) {
                if (event.type === 'cell') {
                    const cellKey = `${event.tableId}:${event.rowId}:${event.cellId}`;
                    const cellListeners = listeners.cell.get(cellKey);
                    if (cellListeners) {
                        cellListeners.forEach(fn => {
                            try { fn(event.newValue, event.old); } catch (e) { console.error('Listener error:', e); }
                        });
                    }
                }
            }

            // 6. Fire tables listeners if needed
            if (types.has('tables')) {
                listeners.tables.forEach(fn => {
                    try { fn(getTables()); } catch (e) { console.error('Listener error:', e); }
                });
            }

            // 7. Clear the transaction queue
            transactionQueue = [];
        }
    }

    // --- JSON serialization ---
    function setJson(json) {
        const obj = JSON.parse(json);
        setValues(obj.values || {});
        setTables(obj.tables || {});
    }
    function getJson() {
        return JSON.stringify({ values, tables });
    }
    function getSchemaJson() {
        return JSON.stringify({ valuesSchema, tablesSchema });
    }

    // --- Manual listener trigger ---
    function callListener(listener) {
        if (typeof listener === 'function') listener();
    }

    // --- Remove schemas ---
    function delValuesSchema() {
        valuesSchema = {};
        setValues(values);
    }
    function delTablesSchema() {
        tablesSchema = {};
        setTables(tables);
    }

    // --- Remove listener by function reference ---
    function delListener(listenerId) {
        // Helper to recursively delete listenerId from any Map or nested Map
        function recursiveDelete(map) {
            if (!(map instanceof Map)) return;
            map.delete(listenerId);
            for (const value of map.values()) {
                if (value instanceof Map) {
                    recursiveDelete(value);
                }
            }
        }
        for (const type of Object.values(listeners)) {
            recursiveDelete(type);
        }
    }

    /**
     * Note: Type enforcement for values and cells only occurs if a schema is set. Without a schema, any value type is accepted.
     */
    const api = {
        // Keyed values
        getValues, getValueIds, getValue, setValues, setValue, delValue, delValues,
        addValueListener, addValuesListener, addValueIdsListener,
        // Tabular data
        getTables, getTableIds, getTable, setTables, setTable, delTable, delTables,
        addTableListener, addTablesListener, addTableIdsListener,
        // Rows/cells
        getRowIds, getRow, setRow, delRow, addRowListener, addRowIdsListener,
        getCellIds, getCell, setCell, delCell, addCellListener, addCellIdsListener,
        // New additions
        getTableCellIds, addTableCellIdsListener, getSortedRowIds, addSortedRowIdsListener,
        // Convenience methods
        hasValue, hasTable, hasRow, hasCell,
        forEachValue, forEachTable, forEachRow, forEachCell,
        addHasValueListener, addHasTableListener, addHasRowListener, addHasCellListener,
        getListenerStats,
        setValuesSchema, getValuesSchema, setTablesSchema, getTablesSchema,
        // Added features
        setPartialValues, setPartialRow, addRow,
        addInvalidValueListener, addInvalidCellListener,
        transaction,
        setJson, getJson, getSchemaJson,
        callListener,
        delValuesSchema, delTablesSchema,
        delListener,
    };
    return api;
}
