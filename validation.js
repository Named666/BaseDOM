// validation.js
export const required = (message = 'This field is required') => 
    (value) => !value ? message : null;

export const minLength = (min, message = `Must be at least ${min} characters`) => 
    (value) => value && value.length < min ? message : null;

export const maxLength = (max, message = `Must be at most ${max} characters`) => 
    (value) => value && value.length > max ? message : null;

export const email = (message = 'Invalid email format') => 
    (value) => value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? message : null;

export const composeValidators = (...validators) => (value) => {
    for (const validator of validators) {
        const error = validator(value);
        if (error) return error;
    }
    return null;
};

// Example:
/*

function LoginForm() {
    const loginForm = createForm({
        initialValues: {
            email: '',
            password: ''
        }
    });
    
    loginForm.setValidator('email', composeValidators(
        required('Email is required'),
        email('Please enter a valid email')
    ));
    
    loginForm.setValidator('password', composeValidators(
        required('Password is required'),
        minLength(8, 'Password must be at least 8 characters')
    ));
    
    const handleSubmit = async ({ email, password }) => {
        try {
            await loginUser(email, password);
        } catch (error) {
            loginForm.setErrors({
                ...loginForm.errors(),
                form: error.message
            });
        }
    };
    
    return Form({
        onSubmit: handleSubmit,
        children: [
            Field({
                label: 'Email',
                name: 'email',
                type: 'email',
                value: loginForm.fields.email,
                onInput: (value) => loginForm.fields.email(value),
                error: loginForm.errors().email,
                touched: true
            }),
            Field({
                label: 'Password',
                name: 'password',
                type: 'password',
                value: loginForm.fields.password,
                onInput: (value) => loginForm.fields.password(value),
                error: loginForm.errors().password,
                touched: true
            }),
            () => loginForm.errors().form 
                ? div({ class: 'form-error' }, loginForm.errors().form)
                : null,
            Submit('Login', { 
                disabled: () => !loginForm.isValid() || loginForm.isSubmitting() 
            })
        ]
    });
}

*/