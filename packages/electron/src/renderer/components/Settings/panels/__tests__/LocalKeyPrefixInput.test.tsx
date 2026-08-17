// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalKeyPrefixInput, type LocalKeyPrefixConfig } from '../LocalKeyPrefixInput';

afterEach(cleanup);

function config(overrides: Partial<LocalKeyPrefixConfig> = {}): LocalKeyPrefixConfig {
  return {
    prefix: 'LOC',
    locked: false,
    matchesTeamPrefix: false,
    ...overrides,
  };
}

describe('LocalKeyPrefixInput', () => {
  it('normalizes and saves an editable prefix', async () => {
    const onChange = vi.fn(async (prefix: string) => config({ prefix }));
    render(<LocalKeyPrefixInput config={config()} teamPrefix="NIM" onChange={onChange} />);

    const input = screen.getByLabelText('Local tracker number prefix');
    fireEvent.change(input, { target: { value: 'dev' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('DEV'));
    expect((input as HTMLInputElement).value).toBe('DEV');
  });

  it('shows a matching-team warning without disabling the choice', () => {
    render(
      <LocalKeyPrefixInput
        config={config({ matchesTeamPrefix: true, warning: 'Choose different letters if you want stronger visual separation.' })}
        teamPrefix="LOC"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Choose different letters if you want stronger visual separation.')).toBeTruthy();
    expect((screen.getByLabelText('Local tracker number prefix') as HTMLInputElement).disabled).toBe(false);
  });

  it('disables editing after a local number has been issued', () => {
    render(
      <LocalKeyPrefixInput
        config={config({ locked: true })}
        teamPrefix="NIM"
        onChange={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Local tracker number prefix') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Locked because this project has already issued local numbers/)).toBeTruthy();
  });

  it('keeps invalid prefixes local instead of invoking the settings API', () => {
    const onChange = vi.fn();
    render(<LocalKeyPrefixInput config={config()} teamPrefix="NIM" onChange={onChange} />);

    const input = screen.getByLabelText('Local tracker number prefix');
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.blur(input);

    expect(screen.getByText('Must be 2-5 uppercase letters')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
