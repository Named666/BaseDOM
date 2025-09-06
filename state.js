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
                value = JSON.parse(storedValue);
            }
        } catch (e) {
            console.warn(`Error loading persistent signal "${key}":`, e);
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
    let value;
    let hasValue = false;
    const [getValue, setValue] = signal(undefined);
    
    // Use effect to track dependencies and update the value
    const dispose = effect(() => {
        const newValue = fn();
        if (!hasValue || !Object.is(value, newValue)) {
            value = newValue;
            hasValue = true;
            setValue(newValue);
        }
    });
    
    // Return a getter that returns the current computed value
    const getter = () => {
        getValue(); // This registers dependency on the computed signal
        return value;
    };
    
    // Attach dispose method for cleanup
    getter.dispose = dispose;
    
    return getter;
}
