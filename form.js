// form.js
import { signal, effect } from './state.js';
import { createComponent } from './components.js';
import { input, button, label, div, select, option, fieldset, textarea } from './html.js';


export function createForm(initialValues = {}) {
    const fields = {};
    const validators = {};
    const [errors, setErrors] = signal({});
    const [isSubmitting, setIsSubmitting] = signal(false);
    const [submitError, setSubmitError] = signal(null);
    const [preventSubmit, setPreventSubmit] = signal(false);
    const [disabled, setDisabled] = signal(false);
    const [touched, setTouched] = signal({});
    const [isValid, setIsValid] = signal(false);

    // Initialize fields
    for (const [name, value] of Object.entries(initialValues)) {
        fields[name] = signal(value);
    }

    // Extract validation logic for reuse
    function validateFields() {
        const newErrors = {};
        let formIsValid = true;
        for (const [name, validator] of Object.entries(validators)) {
            if (validator && fields[name]) {
                const error = validator(fields[name]());
                if (error) {
                    newErrors[name] = error;
                    formIsValid = false;
                }
            }
        }
        setErrors(newErrors);
        setIsValid(formIsValid);
    }
    // Run validation whenever any field changes
    effect(validateFields);
    // Initial validation
    validateFields();

    return {
        fields,
        errors,
        isValid,
        isSubmitting,
        submitError,
        preventSubmit,
        setPreventSubmit,
        disabled,
        setDisabled,
        touched,
        // Update validators and re-run validation immediately
         setValidator(name, validator) {
            validators[name] = validator;
            validateFields();
         },
         setFieldTouched(name) {
             setTouched(prev => ({ ...prev, [name]: true }));
         },
         handleSubmit(onSubmit) {
              return async (e) => {
                 e.preventDefault();
                if (preventSubmit() || isSubmitting()) return;
                if (!isValid()) {
                    // mark all fields as touched so errors show
                    const allTouched = {};
                    for (const name in fields) allTouched[name] = true;
                    setTouched(allTouched);
                    return;
                }
                
                setIsSubmitting(true);
                try {
                    const values = {};
                    for (const [name, field] of Object.entries(fields)) {
                        values[name] = field();
                    }
                    await onSubmit(values);
                    setSubmitError(null);
                 } catch (err) {
                    setSubmitError(err && err.message ? err.message : String(err));
                 } finally {
                     setIsSubmitting(false);
                 }
             };
         },
        reset() {
            for (const [name, initialValue] of Object.entries(initialValues)) {
                fields[name](initialValue);
            }
            setErrors({});
            setTouched({});
            setSubmitError(null);
        }
    };
}

const formContexts = new WeakMap();

export function useFormContext(formElement) {
    return formContexts.get(formElement);
}

export function Form(optionsOrChildren, childrenIfAttrs) {
    const isOpts = typeof optionsOrChildren === 'object' && !Array.isArray(optionsOrChildren);
    
    let formOptions = isOpts ? optionsOrChildren : {};
    let children = isOpts ? (childrenIfAttrs || formOptions.children) : optionsOrChildren;
    // normalize children into array to avoid [undefined]
    if (!Array.isArray(children)) {
        children = children ? [children] : [];
    }
    
    // New: Collect initial values from Field components
    const collectedInitialValues = {};
    const processChildren = (items) => {
        if (!Array.isArray(items)) items = [items];
        items.forEach(child => {
            if (child?.type === Field) {
                const { name, value: val, type: t } = child.props;
                const defaultVal = val ?? (t === 'checkbox' ? false : '');
                collectedInitialValues[name] = defaultVal;
            }
            if (child?.props?.children) {
                processChildren(child.props.children);
            }
        });
    };
    processChildren(children);
    const finalInitialValues = {
        ...collectedInitialValues,
        ...(formOptions.initialValues || {})
    };
    
    const form = createForm(finalInitialValues);
    
    if (formOptions.validators) {
        for (const [name, validator] of Object.entries(formOptions.validators)) {
            form.setValidator(name, validator);
        }
    }
    
    const formElement = createComponent('form', {
        ...formOptions,
        attrs: {
            ...formOptions.attrs,
            'data-form': true,
            // Set form context on actual DOM element
            ref: el => formContexts.set(el, form)
        },
        onSubmit: formOptions.onSubmit ? form.handleSubmit(formOptions.onSubmit) : undefined,
        children: [
            () => fieldset({ attrs: { disabled: form.disabled() } }, children),
            () => form.submitError() && div({ attrs: { role: 'alert', 'aria-live': 'assertive' }, class: 'form-error' }, form.submitError())
        ]
    });
    
    return formElement;
}

export function Field({
    label: text,
    name,
    type = 'text',
    value,
    onInput,
    attrs = {},
    labelAttrs = {},
    wrapperAttrs = {},
    error,
    touched,
    ...rest
}, children) {
    // Set default value based on type if not provided
   const defaultValue = type === 'checkbox' ? false : type === 'number' ? 0 : '';
   value = value ?? defaultValue;

    let inputEl;
    if (children) {
        inputEl = children;
    } else if (type === 'textarea') {
        inputEl = textarea({
            attrs: {
                id: name,
                name,
                ...attrs,
                class: `${attrs.class || ''} ${error && touched ? 'error' : ''}`.trim(),
                'aria-invalid': !!error,
                'aria-describedby': error ? `${name}-error` : undefined,
                'aria-required': !!attrs.required,
                'aria-disabled': attrs.disabled
            },
            onInput: e => {
                const val = e.target.value;
                if (onInput) onInput(val);
                const form = useFormContext(e.target.form);
                if (form) form.fields[name](val);
            },
            onBlur: e => {
                if (rest.onBlur) rest.onBlur(e);
                const form = useFormContext(e.target.form);
                if (form) form.setFieldTouched(name);
            }
        }, value);
    } else if (type === 'select') {
        inputEl = select({
            attrs: {
                id: name,
                name,
                ...attrs,
                class: `${attrs.class || ''} ${error && touched ? 'error' : ''}`.trim(),
                'aria-required': !!attrs.required,
                'aria-disabled': attrs.disabled
            },
            onInput: e => {
                const val = e.target.value;
                if (onInput) onInput(val);
                const form = useFormContext(e.target.form);
                if (form) form.fields[name](val);
            },
            onBlur: e => {
                if (rest.onBlur) rest.onBlur(e);
                const form = useFormContext(e.target.form);
                if (form) form.setFieldTouched(name);
            }
        }, (rest.options || []).map(opt => option({ attrs: { value: opt.value } }, opt.label)));
    } else if (type === 'checkbox' || type === 'radio') {
        inputEl = input({
            attrs: {
                id: name,
                name,
                type,
                checked: value,
                ...attrs,
                'aria-required': !!attrs.required,
                'aria-disabled': attrs.disabled
            },
            onChange: e => {
                const val = e.target.checked;
                if (onInput) onInput(val);
                const form = useFormContext(e.target.form);
                if (form) form.fields[name](val);
            },
            onBlur: e => {
                if (rest.onBlur) rest.onBlur(e);
                const form = useFormContext(e.target.form);
                if (form) form.setFieldTouched(name);
            }
        });
    } else {
        inputEl = input({
            attrs: {
                id: name,
                name,
                type,
                value,
                ...attrs,
                class: `${attrs.class || ''} ${error && touched ? 'error' : ''}`.trim(),
                'aria-invalid': !!error,
                'aria-describedby': error ? `${name}-error` : undefined,
                'aria-required': !!attrs.required,
                'aria-disabled': attrs.disabled
            },
            onInput: e => {
                let val = e.target.value;
                if (type === 'number') val = parseFloat(val);
                if (onInput) onInput(val);
                const form = useFormContext(e.target.form);
                if (form) form.fields[name](val);
            },
            onBlur: e => {
                if (rest.onBlur) rest.onBlur(e);
                const form = useFormContext(e.target.form);
                if (form) form.setFieldTouched(name);
            }
        });
    }
    
    return div({
        attrs: wrapperAttrs,
        children: [
            label({ attrs: { for: name, ...labelAttrs } }, text),
            inputEl,
            error && touched ? div({
                attrs: { id: `${name}-error`, role: 'alert', 'aria-live': 'polite' },
                class: 'error-message'
            }, error) : null
        ]
    });
}

export function Submit(text, opts = {}) {
   const { attrs = {}, isSubmitting, loadingText, ...rest } = opts;
  // Determine submitting state (supports signal or boolean)
  const submitting = typeof isSubmitting === 'function' ? isSubmitting() : isSubmitting;
  return button({
    attrs: { type: 'submit', disabled: submitting, ...attrs },
    ...rest
  }, submitting ? (loadingText || text) : text);
 }

