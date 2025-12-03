import { test, expect } from '@playwright/test';

test('bento card text input works', async ({ page }) => {
  await page.goto('/');

  // Inject a dummy question using the debug helper
  await page.evaluate(() => {
    (window as any).specBridgeDebug.setQuestions([
      { id: 'q1', text: 'What is your vision?', answered: false }
    ]);
  });

  // Verify the question card is visible
  const card = page.locator('.bento-card').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('What is your vision?');

  // Click the card to expand it
  await card.click();
  await expect(card).toHaveClass(/active/);

  // Verify text input appears
  const input = card.locator('input[type="text"]');
  await expect(input).toBeVisible();

  // Type into the input
  await input.fill('My vision is a world peace app');
  
  // Verify input value
  await expect(input).toHaveValue('My vision is a world peace app');

  // Submit the form (simulating Enter key)
  await input.press('Enter');

  // Since we mocked sending, we can check if the input was cleared (standard behavior of TextInput on send)
  await expect(input).toHaveValue('');
});
