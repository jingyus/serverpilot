/**
 * E2E Test: User Registration & Login Flow
 *
 * Tests the complete authentication lifecycle through the dashboard UI:
 * 1. User registration with form validation
 * 2. Login with registered credentials
 * 3. Token refresh
 * 4. Logout
 * 5. Error handling (duplicate email, wrong password)
 *
 * @module tests/e2e/01-auth-flow
 */

import { test, expect } from '@playwright/test';
import { registerUser, uniqueEmail } from './helpers';

test.describe('User Registration & Login Flow', () => {
  const testPassword = 'SecurePass123!';

  test('should display login page by default', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('ServerPilot')).toBeVisible();
    await expect(page.getByText('Sign in to your account')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('should switch to register mode and back', async ({ page }) => {
    await page.goto('/login');

    // Switch to register
    await page.getByRole('button', { name: /Register/ }).click();
    await expect(page.getByText('Create a new account')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Confirm Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

    // Switch back to login
    await page.getByRole('button', { name: /Sign in/ }).click();
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });

  test('should show validation errors on empty login', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: 'Sign In' }).click();

    // Zod validation triggers on submit, showing error messages
    await expect(
      page.getByText('Please enter a valid email address'),
    ).toBeVisible();
  });

  test('should register a new user via UI', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/login');
    await page.getByRole('button', { name: /Register/ }).click();

    // Wait for register form to be visible
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Confirm Password')).toBeVisible();

    await page.getByLabel('Name').fill('E2E Test User');
    await page.getByLabel('Email').fill(email);
    await page.locator('#password').fill(testPassword);
    await page.locator('#confirmPassword').fill(testPassword);

    await page.getByRole('button', { name: 'Create Account' }).click();

    // Should redirect to dashboard on success
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('should login with registered credentials', async ({ page, request }) => {
    // First register a user via API
    const email = uniqueEmail();
    await registerUser(request, { email, password: testPassword, name: 'Login Test' });

    // Now login via UI
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(testPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Wait for login form to be visible
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    await page.getByLabel('Email').fill('nonexistent@test.local');
    await page.getByLabel('Password').fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should show error message
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 });
  });

  test('should prevent duplicate registration', async ({ page, request }) => {
    const email = uniqueEmail();
    await registerUser(request, { email, password: testPassword, name: 'Existing User' });

    // Try to register same email via UI
    await page.goto('/login');
    await page.getByRole('button', { name: /Register/ }).click();

    // Wait for register form to be visible
    await expect(page.getByLabel('Name')).toBeVisible();

    await page.getByLabel('Name').fill('Duplicate User');
    await page.getByLabel('Email').fill(email);
    await page.locator('#password').fill(testPassword);
    await page.locator('#confirmPassword').fill(testPassword);
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Should show error about duplicate email
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 });
  });

  test('should validate password confirmation mismatch', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Register/ }).click();

    // Wait for register form to be visible
    await expect(page.getByLabel('Name')).toBeVisible();

    await page.getByLabel('Name').fill('Mismatch Test');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.locator('#password').fill(testPassword);
    await page.locator('#confirmPassword').fill('DifferentPass123!');
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Should show password mismatch error
    await expect(page.getByText(/do not match/i)).toBeVisible({ timeout: 5_000 });
  });

  test('API: token refresh works', async ({ request }) => {
    const user = await registerUser(request, { password: testPassword });

    // Use refresh token to get new access token
    const res = await request.post('http://localhost:3000/api/v1/auth/refresh', {
      data: { refreshToken: user.refreshToken },
    });

    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.accessToken).toBeTruthy();
    expect(json.refreshToken).toBeTruthy();
  });

  test('API: logout endpoint responds', async ({ request }) => {
    const res = await request.post('http://localhost:3000/api/v1/auth/logout');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.message).toBe('Logged out successfully');
  });
});
