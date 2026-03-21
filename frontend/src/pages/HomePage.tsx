import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetHome, useGetDocuments } from '../generated/anthoLumeAPIV1';
import type { LeaderboardData } from '../generated/model';
import ReadingHistoryGraph from '../components/ReadingHistoryGraph';
import { formatNumber, formatDuration } from '../utils/formatters';

interface InfoCardProps {
  title: string;
  size: string | number;
  link?: string;
}

function InfoCard({ title, size, link }: InfoCardProps) {
  if (link) {
    return (
      <Link to={link} className="w-full">
        <div className="flex w-full gap-4 rounded bg-white p-4 shadow-lg dark:bg-gray-700">
          <div className="flex w-full flex-col justify-around text-sm dark:text-white">
            <p className="text-2xl font-bold text-black dark:text-white">{size}</p>
            <p className="text-sm text-gray-400">{title}</p>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div className="w-full">
      <div className="flex w-full gap-4 rounded bg-white p-4 shadow-lg dark:bg-gray-700">
        <div className="flex w-full flex-col justify-around text-sm dark:text-white">
          <p className="text-2xl font-bold text-black dark:text-white">{size}</p>
          <p className="text-sm text-gray-400">{title}</p>
        </div>
      </div>
    </div>
  );
}

interface StreakCardProps {
  window: 'DAY' | 'WEEK';
  currentStreak: number;
  currentStreakStartDate: string;
  currentStreakEndDate: string;
  maxStreak: number;
  maxStreakStartDate: string;
  maxStreakEndDate: string;
}

function StreakCard({
  window,
  currentStreak,
  currentStreakStartDate,
  currentStreakEndDate,
  maxStreak,
  maxStreakStartDate,
  maxStreakEndDate,
}: StreakCardProps) {
  return (
    <div className="w-full">
      <div className="relative w-full rounded bg-white px-4 py-6 shadow-lg dark:bg-gray-700">
        <p className="w-max border-b border-gray-200 text-sm font-semibold text-gray-700 dark:border-gray-500 dark:text-white">
          {window === 'WEEK' ? 'Weekly Read Streak' : 'Daily Read Streak'}
        </p>
        <div className="my-6 flex items-end space-x-2">
          <p className="text-5xl font-bold text-black dark:text-white">{currentStreak}</p>
        </div>
        <div className="dark:text-white">
          <div className="mb-2 flex items-center justify-between border-b border-gray-200 pb-2 text-sm">
            <div>
              <p>{window === 'WEEK' ? 'Current Weekly Streak' : 'Current Daily Streak'}</p>
              <div className="flex items-end text-sm text-gray-400">
                {currentStreakStartDate} ➞ {currentStreakEndDate}
              </div>
            </div>
            <div className="flex items-end font-bold">{currentStreak}</div>
          </div>
          <div className="mb-2 flex items-center justify-between pb-2 text-sm">
            <div>
              <p>{window === 'WEEK' ? 'Best Weekly Streak' : 'Best Daily Streak'}</p>
              <div className="flex items-end text-sm text-gray-400">
                {maxStreakStartDate} ➞ {maxStreakEndDate}
              </div>
            </div>
            <div className="flex items-end font-bold">{maxStreak}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LeaderboardCardProps {
  name: string;
  data: LeaderboardData;
}

type TimePeriod = 'all' | 'year' | 'month' | 'week';

function LeaderboardCard({ name, data }: LeaderboardCardProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('all');

  const formatValue = (value: number): string => {
    switch (name) {
      case 'WPM':
        return `${value.toFixed(2)} WPM`;
      case 'Duration':
        return formatDuration(value);
      case 'Words':
        return formatNumber(value);
      default:
        return value.toString();
    }
  };

  const currentData = data[selectedPeriod];

  const handlePeriodChange = (period: TimePeriod) => {
    setSelectedPeriod(period);
  };

  return (
    <div className="w-full">
      <div className="flex size-full flex-col justify-between rounded bg-white px-4 py-6 shadow-lg dark:bg-gray-700">
        <div>
          <div className="flex justify-between">
            <p className="w-max border-b border-gray-200 text-sm font-semibold text-gray-700 dark:border-gray-500 dark:text-white">
              {name} Leaderboard
            </p>
            <div className="flex gap-2 text-xs text-gray-400 items-center">
              <button
                type="button"
                onClick={() => handlePeriodChange('all')}
                className={`cursor-pointer hover:text-black dark:hover:text-white ${selectedPeriod === 'all' ? '!text-black dark:!text-white' : ''}`}
              >
                all
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange('year')}
                className={`cursor-pointer hover:text-black dark:hover:text-white ${selectedPeriod === 'year' ? '!text-black dark:!text-white' : ''}`}
              >
                year
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange('month')}
                className={`cursor-pointer hover:text-black dark:hover:text-white ${selectedPeriod === 'month' ? '!text-black dark:!text-white' : ''}`}
              >
                month
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange('week')}
                className={`cursor-pointer hover:text-black dark:hover:text-white ${selectedPeriod === 'week' ? '!text-black dark:!text-white' : ''}`}
              >
                week
              </button>
            </div>
          </div>
        </div>

        {/* Current period data */}
        <div className="my-6 flex items-end space-x-2">
          {currentData?.length === 0 ? (
            <p className="text-5xl font-bold text-black dark:text-white">N/A</p>
          ) : (
            <p className="text-5xl font-bold text-black dark:text-white">
              {currentData[0]?.user_id || 'N/A'}
            </p>
          )}
        </div>

        <div className="dark:text-white">
          {currentData?.slice(0, 3).map((item: any, index: number) => (
            <div
              key={index}
              className={`flex items-center justify-between py-2 text-sm ${index > 0 ? 'border-t border-gray-200' : ''}`}
            >
              <div>
                <p>{item.user_id}</p>
              </div>
              <div className="flex items-end font-bold">{formatValue(item.value)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data: homeData, isLoading: homeLoading } = useGetHome();
  const { data: docsData, isLoading: docsLoading } = useGetDocuments({ page: 1, limit: 9 });

  const docs = docsData?.data?.documents;
  const dbInfo = homeData?.data?.database_info;
  const streaks = homeData?.data?.streaks?.streaks;
  const graphData = homeData?.data?.graph_data?.graph_data;
  const userStats = homeData?.data?.user_statistics;

  if (homeLoading || docsLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Daily Read Totals Graph */}
      <div className="w-full">
        <div className="relative w-full rounded bg-white shadow-lg dark:bg-gray-700">
          <p className="absolute left-5 top-3 w-max border-b border-gray-200 text-sm font-semibold text-gray-700 dark:border-gray-500 dark:text-white">
            Daily Read Totals
          </p>
          <ReadingHistoryGraph data={graphData || []} />
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <InfoCard title="Documents" size={dbInfo?.documents_size || 0} link="./documents" />
        <InfoCard title="Activity Records" size={dbInfo?.activity_size || 0} link="./activity" />
        <InfoCard title="Progress Records" size={dbInfo?.progress_size || 0} link="./progress" />
        <InfoCard title="Devices" size={dbInfo?.devices_size || 0} />
      </div>

      {/* Streak Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {streaks?.map((streak: any, index) => (
          <StreakCard
            key={index}
            window={streak.window as 'DAY' | 'WEEK'}
            currentStreak={streak.current_streak}
            currentStreakStartDate={streak.current_streak_start_date}
            currentStreakEndDate={streak.current_streak_end_date}
            maxStreak={streak.max_streak}
            maxStreakStartDate={streak.max_streak_start_date}
            maxStreakEndDate={streak.max_streak_end_date}
          />
        ))}
      </div>

      {/* Leaderboard Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <LeaderboardCard
          name="WPM"
          data={userStats?.wpm || { all: [], year: [], month: [], week: [] }}
        />
        <LeaderboardCard
          name="Duration"
          data={userStats?.duration || { all: [], year: [], month: [], week: [] }}
        />
        <LeaderboardCard
          name="Words"
          data={userStats?.words || { all: [], year: [], month: [], week: [] }}
        />
      </div>

      {/* Recent Documents */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {docs?.slice(0, 6).map((doc: any) => (
          <div
            key={doc.id}
            className="flex flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white"
          >
            <h3 className="text-lg font-medium">{doc.title}</h3>
            <p className="text-sm">{doc.author}</p>
            <Link
              to={`/documents/${doc.id}`}
              className="rounded bg-blue-700 py-1 text-center text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              View Document
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
