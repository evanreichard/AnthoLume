import { AuthProvider } from './auth/AuthContext';
import { Routes } from './Routes';

function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}

export default App;